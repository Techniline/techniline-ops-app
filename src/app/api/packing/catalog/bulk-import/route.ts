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

/** Normalise a header string for flexible column matching */
function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map a parsed row object to a catalog record */
function mapRow(raw: Record<string, unknown>, brand: string, userId: string): Record<string, unknown> | null {
  // Build a normalised key→value map
  const keys = Object.keys(raw);
  const get = (...candidates: string[]): unknown => {
    for (const c of candidates) {
      const k = keys.find((k) => norm(k) === c || norm(k).includes(c));
      if (k !== undefined && raw[k] != null && raw[k] !== "") return raw[k];
    }
    return null;
  };

  const modelNo = String(get("itemcode", "modelno", "sku", "model", "code", "partno", "part") ?? "").trim();
  if (!modelNo) return null;

  const ctnL = Number(get("mastercartonlength", "length", "l", "cartonlength")) || null;
  const ctnW = Number(get("mastercartonwidth", "width", "w", "cartonwidth")) || null;
  const ctnH = Number(get("mastercartonheight", "height", "h", "cartonheight")) || null;

  // Volume: prefer explicit column; compute from dims if absent (cm → m³)
  let cartonCbm = Number(get("mastercartonvolume", "cartonvolume", "volume", "cbm", "mastercartonvolumem3")) || null;
  if (!cartonCbm && ctnL && ctnW && ctnH) {
    cartonCbm = Math.round((ctnL * ctnW * ctnH) / 1_000_000 * 100000) / 100000;
  }

  const rawHs = get("hscode", "hs", "hscode", "harmonizedcode");
  const hsCode = rawHs != null ? String(rawHs).replace(/\.0$/, "").trim() || null : null;

  const cartonQty = Number(get("mastercartonpackagingqty", "packagingqty", "pcspercarton", "pcs", "qty", "cartonqty", "masterpackqty")) || null;
  const cartonWeight = Number(get("mastercartonweight", "cartonweight", "gw", "grossweight", "mastercartonweightkg", "mastercartongw")) || null;

  const unitCbm = Number(get("volumeperpc", "unitcbm", "unitvolume", "volumeperpiece")) || null;
  const unitWeight = Number(get("unitweightkg", "unitweight", "netweight", "nw")) || null;

  const description = String(get("description", "desc", "productname", "name", "productdescription") ?? "").trim() || null;
  const country = String(get("countryoforigin", "country", "origin", "madeincountry") ?? "China").trim() || "China";

  return {
    model_no: modelNo,
    brand: brand || null,
    description,
    hs_code: hsCode,
    country_of_origin: country,
    unit_weight_kg: unitWeight,
    unit_cbm: unitCbm,
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
 * Accepts multipart/form-data with:
 *   file  — .xlsx, .xls, or .csv
 *   brand — brand name to apply to all rows (optional; falls back to a "Brand" column in the file)
 *
 * Upserts on model_no (case-insensitive via ilike). Returns counts.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getUser(request);
  if (!user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let fileBuffer: Buffer;
  let fileName: string;
  let brand = "";
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ ok: false, error: "No file uploaded." }, { status: 400 });
    fileName = file.name.toLowerCase();
    brand = String(form.get("brand") ?? "").trim();
    fileBuffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return Response.json({ ok: false, error: "Could not read uploaded file." }, { status: 400 });
  }

  // Parse to rows
  let rows: Record<string, unknown>[];
  try {
    const wb = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  } catch {
    return Response.json({ ok: false, error: "Could not parse file. Make sure it is a valid .xlsx, .xls, or .csv." }, { status: 400 });
  }

  if (!rows.length) return Response.json({ ok: false, error: "File is empty or has no data rows." }, { status: 400 });

  // Map rows to catalog records
  const records = rows.map((r) => mapRow(r, brand, user.id)).filter((r): r is Record<string, unknown> => r !== null);
  if (!records.length) return Response.json({ ok: false, error: "No valid rows found. Make sure the file has a model number column." }, { status: 400 });

  // Upsert in batches of 100 on model_no (case-insensitive match via DB)
  const svc = svcClient();
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    try {
      // For each record, check if it already exists (case-insensitive model_no)
      for (const rec of batch) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (svc.from("packing_sku_catalog" as any) as any)
          .select("id")
          .ilike("model_no", rec.model_no as string)
          .maybeSingle();

        if (existing?.id) {
          // Update — only fill in fields that are currently null
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: current } = await (svc.from("packing_sku_catalog" as any) as any)
            .select("*").eq("id", existing.id).single();

          const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          for (const [k, v] of Object.entries(rec)) {
            if (["source", "created_by", "updated_at", "model_no"].includes(k)) continue;
            if (v != null && v !== "" && (current[k] == null || current[k] === "")) {
              patch[k] = v;
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (svc.from("packing_sku_catalog" as any) as any).update(patch).eq("id", existing.id);
          updated++;
        } else {
          // Insert new
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (svc.from("packing_sku_catalog" as any) as any).insert(rec);
          if (error) errors++;
          else inserted++;
        }
      }
    } catch {
      errors += batch.length;
    }
  }

  void fileName;
  return Response.json({ ok: true, total: records.length, inserted, updated, errors });
}
