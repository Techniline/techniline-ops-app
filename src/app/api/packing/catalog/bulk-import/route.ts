import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUser(request: Request): Promise<{ id: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

function svcClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapRow(raw: Record<string, unknown>, brand: string, userId: string): Record<string, unknown> | null {
  const keys = Object.keys(raw);
  const get = (...candidates: string[]): unknown => {
    for (const c of candidates) {
      const k = keys.find((k) => norm(k) === c || norm(k).includes(c));
      if (k !== undefined && raw[k] != null && raw[k] !== "") return raw[k];
    }
    return null;
  };

  // If a dedicated MODEL/MODELNO column exists, use it exclusively as model_no.
  // If it's empty on this row, it's a category/header row — skip.
  const hasModelCol = keys.some((k) => norm(k) === "model" || norm(k) === "modelno");
  let modelNo: string;
  if (hasModelCol) {
    modelNo = String(get("modelno", "model") ?? "").trim().replace(/[^A-Za-z0-9]/g, "");
    if (!modelNo) return null;
  } else {
    modelNo = String(get("itemcode", "sku", "code", "partno", "part") ?? "").trim().replace(/[^A-Za-z0-9]/g, "");
    if (!modelNo) return null;
  }

  const ctnL = Number(get("mastercartonlength", "cartonlength", "cartondimensionl", "length")) || null;
  const ctnW = Number(get("mastercartonwidth", "cartonwidth", "cartondimensionw", "width")) || null;
  const ctnH = Number(get("mastercartonheight", "cartonheight", "cartondimensionh", "height")) || null;

  // Unit CBM — check specific unit-level column names before the generic "cbm" fallback
  // "CUBE CBM/UNIT" normalises to "cubecbmunit" which contains "cbmunit"
  const unitCbm = Number(get("volumeperpc", "unitcbm", "unitvolume", "volumeperpiece", "cbmunit", "cubecbm", "unitvolumem3")) || null;

  // Carton CBM — carton-level columns only, then dim calculation
  // "Volume" (Alesis) normalises to "volume"
  let cartonCbm = Number(get("mastercartonvolume", "cartonvolume", "mastercartonvolumem3", "mastercbm", "cartoncbm", "volume")) || null;
  if (!cartonCbm && ctnL && ctnW && ctnH) {
    cartonCbm = Math.round((ctnL * ctnW * ctnH) / 1_000_000 * 100000) / 100000;
  }
  // If no carton CBM but we have unit CBM, treat unit CBM as carton CBM (1 per carton items)
  if (!cartonCbm && unitCbm) cartonCbm = unitCbm;

  // Gross weight per carton — "G.W./CTN" normalises to "gwctn"; plain "GW" (Alesis) normalises to "gw"
  const cartonWeight = Number(get("mastercartonweight", "mastercartongw", "grossweightctn", "gwctn", "gw", "grossweight", "cartonweight", "cartonweightkg")) || null;

  // Unit / net weight — "N.W./CTN" normalises to "nwctn" which contains "nw"
  const unitWeight = Number(get("unitweightkg", "unitweight", "netweight", "nw", "nwkg")) || null;

  // "MC Qty" (Alesis) normalises to "mcqty"
  const cartonQty = Number(get("mastercartonpackagingqty", "packagingqty", "pcspercarton", "qtypercarton", "cartonqty", "masterpackqty", "mcqty", "pcs")) || null;

  // Derive unit CBM from carton CBM ÷ qty when no explicit unit column exists (e.g. Alesis)
  const unitCbmFinal = unitCbm ?? (cartonCbm && cartonQty && cartonQty > 0
    ? Math.round(cartonCbm / cartonQty * 1_000_000) / 1_000_000
    : null);

  // Derive unit weight from carton GW ÷ MC Qty when no net weight column exists (e.g. Alesis)
  const unitWeightFinal = unitWeight ?? (cartonWeight && cartonQty && cartonQty > 0
    ? Math.round(cartonWeight / cartonQty * 100) / 100
    : null);

  const rawHs = get("hscode", "hs", "harmonizedcode", "hstariff", "hsncode");
  const hsCode = rawHs != null ? String(rawHs).replace(/\.0$/, "").trim() || null : null;

  // Description — also try "Product Type" (normalises to "producttype" which contains "producttype")
  const description = String(
    get("description", "desc", "productdescription", "productname", "name", "producttype", "type") ?? ""
  ).trim() || null;

  const country = String(get("countryoforigin", "country", "origin", "madeincountry") ?? "China").trim() || "China";

  return {
    model_no: modelNo,
    brand: brand || null,
    description,
    hs_code: hsCode,
    country_of_origin: country,
    unit_weight_kg: unitWeightFinal,
    unit_cbm: unitCbmFinal,
    carton_qty: cartonQty,
    carton_weight_kg: cartonWeight,
    carton_cbm: cartonCbm,
    source: "import",
    created_by: userId,
    updated_at: new Date().toISOString(),
  };
}

/**
 * POST /api/packing/catalog/bulk-import
 * Accepts multipart/form-data: file (.xlsx/.xls/.csv) + brand string
 * Strategy: fetch all existing catalog records once, compare in memory,
 * then batch-insert new rows and per-record update existing (null fields only).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    // --- Parse form data ---
    let fileBuffer: Buffer;
    let brand = "";
    try {
      const form = await request.formData();
      const file = form.get("file") as File | null;
      if (!file) return Response.json({ ok: false, error: "No file uploaded." }, { status: 400 });
      brand = String(form.get("brand") ?? "").trim();
      fileBuffer = Buffer.from(await file.arrayBuffer());
    } catch {
      return Response.json({ ok: false, error: "Could not read uploaded file." }, { status: 400 });
    }

    // --- Parse spreadsheet ---
    let rows: Record<string, unknown>[];
    try {
      const wb = XLSX.read(fileBuffer, { type: "buffer", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
    } catch {
      return Response.json({ ok: false, error: "Could not parse file. Make sure it is a valid .xlsx, .xls, or .csv." }, { status: 400 });
    }

    if (!rows.length) return Response.json({ ok: false, error: "File is empty or has no data rows." }, { status: 400 });

    const records = rows
      .map((r) => mapRow(r, brand, user.id))
      .filter((r): r is Record<string, unknown> => r !== null);

    if (!records.length) {
      return Response.json({ ok: false, error: "No valid rows found. Check that the file has model number and data columns." }, { status: 400 });
    }

    const svc = svcClient();

    // --- Fetch ALL existing catalog records in batches (bypass PostgREST 1000-row cap) ---
    const existingRows: Record<string, unknown>[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
        .select("id, model_no, brand, description, hs_code, country_of_origin, unit_weight_kg, unit_cbm, carton_qty, carton_weight_kg, carton_cbm")
        .order("model_no", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      existingRows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Build normalised model_no → record lookup.
    // Strip non-alphanumeric chars from DB keys too, so records the Fix Model Nos
    // step missed (still have hyphens/spaces) still match the normalised import key.
    const existingMap = new Map<string, Record<string, unknown>>(
      existingRows.map((r) => [
        (r.model_no as string).replace(/[^A-Za-z0-9]/g, "").toLowerCase(),
        r,
      ])
    );

    // --- Deduplicate import records by model_no (last row wins — most likely to be most complete) ---
    const dedupedMap = new Map<string, Record<string, unknown>>();
    for (const rec of records) {
      const key = (rec.model_no as string).toLowerCase();
      const prev = dedupedMap.get(key);
      if (!prev) {
        dedupedMap.set(key, rec);
      } else {
        // Merge: keep non-null values from both, later row wins on conflict
        const merged = { ...prev };
        for (const [k, v] of Object.entries(rec)) {
          if (v != null && v !== "") merged[k] = v;
        }
        dedupedMap.set(key, merged);
      }
    }
    const dedupedRecords = Array.from(dedupedMap.values());

    // --- Split import records into inserts and updates ---
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];
    let alreadyComplete = 0;

    for (const rec of dedupedRecords) {
      const existing = existingMap.get((rec.model_no as string).toLowerCase());
      if (existing) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const [k, v] of Object.entries(rec)) {
          if (["source", "created_by", "updated_at", "model_no"].includes(k)) continue;
          if (v != null && v !== "" && (existing[k] == null || existing[k] === "")) {
            patch[k] = v;
          }
        }
        if (Object.keys(patch).length > 1) {
          toUpdate.push({ id: existing.id as string, patch });
        } else {
          alreadyComplete++;
        }
      } else {
        toInsert.push(rec);
      }
    }

    let inserted = 0, updated = 0, errors = 0;

    // --- Batch insert new records (100 at a time) ---
    // Use upsert with ignoreDuplicates so a single conflict doesn't wipe out the whole batch.
    const INSERT_BATCH = 100;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      const batch = toInsert.slice(i, i + INSERT_BATCH);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (svc.from("packing_sku_catalog" as any) as any)
          .upsert(batch, { onConflict: "model_no", ignoreDuplicates: true });
        if (error) errors += batch.length;
        else inserted += batch.length;
      } catch {
        errors += batch.length;
      }
    }

    // --- Update existing records (null-fill only) ---
    for (const { id, patch } of toUpdate) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (svc.from("packing_sku_catalog" as any) as any).update(patch).eq("id", id);
        if (error) errors++;
        else updated++;
      } catch {
        errors++;
      }
    }

    return Response.json({
      ok: true,
      total: dedupedRecords.length,
      inserted,
      updated,
      skipped: alreadyComplete,
      errors,
    });
  } catch (err) {
    // Top-level catch — always return JSON so the client can parse the error
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
