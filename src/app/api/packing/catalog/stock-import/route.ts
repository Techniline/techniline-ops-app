import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

/**
 * POST /api/packing/catalog/stock-import
 * Accepts the Stock List xlsx file (row 1 = metadata, row 2 = headers: ItemCode, Description, Brand).
 * Matches ItemCodes against catalog model_no and fills in null description/brand fields.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getUser(request);
    if (!user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    // --- Parse uploaded file ---
    let fileBuffer: Buffer;
    try {
      const form = await request.formData();
      const file = form.get("file") as File | null;
      if (!file) return Response.json({ ok: false, error: "No file uploaded." }, { status: 400 });
      fileBuffer = Buffer.from(await file.arrayBuffer());
    } catch {
      return Response.json({ ok: false, error: "Could not read uploaded file." }, { status: 400 });
    }

    // --- Parse xlsx: row 1 metadata (skip), row 2 = headers, row 3+ = data ---
    let stockMap: Map<string, { description: string | null; brand: string | null }>;
    try {
      const wb = XLSX.read(fileBuffer, { type: "buffer", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // sheetRows gives raw arrays; first row is metadata, second is headers
      const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
      if (allRows.length < 3) {
        return Response.json({ ok: false, error: "Stock List too short — expected metadata row, header row, then data." }, { status: 400 });
      }

      const headers = (allRows[1] as unknown[]).map((h) => norm(h));
      const idxCode  = headers.findIndex((h) => h === "itemcode");
      const idxDesc  = headers.findIndex((h) => h === "description");
      const idxBrand = headers.findIndex((h) => h === "brand");

      if (idxCode === -1) {
        return Response.json({ ok: false, error: `'ItemCode' column not found. Headers: ${(allRows[1] as unknown[]).join(", ")}` }, { status: 400 });
      }

      stockMap = new Map();
      for (let i = 2; i < allRows.length; i++) {
        const row = allRows[i] as unknown[];
        const code = String(row[idxCode] ?? "").trim();
        if (!code) continue;
        const desc  = idxDesc  >= 0 && row[idxDesc]  != null ? String(row[idxDesc]).trim()  || null : null;
        const brand = idxBrand >= 0 && row[idxBrand] != null ? String(row[idxBrand]).trim() || null : null;
        stockMap.set(code.toLowerCase(), { description: desc, brand });
      }
    } catch {
      return Response.json({ ok: false, error: "Could not parse file." }, { status: 400 });
    }

    const svc = svcClient();

    // --- Fetch all catalog records (paginated) ---
    const catalog: Array<{ id: string; model_no: string; description: string | null; brand: string | null }> = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
        .select("id, model_no, description, brand")
        .order("model_no", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      catalog.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // --- Match and collect patches ---
    type Patch = { id: string; patch: Record<string, unknown> };
    const toUpdate: Patch[] = [];

    for (const item of catalog) {
      const stock = stockMap.get((item.model_no ?? "").toLowerCase());
      if (!stock) continue;
      const patch: Record<string, unknown> = {};
      if (item.description == null && stock.description) patch.description = stock.description;
      if (item.brand == null && stock.brand) patch.brand = stock.brand;
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        toUpdate.push({ id: item.id, patch });
      }
    }

    if (toUpdate.length === 0) {
      return Response.json({ ok: true, total: catalog.length, matched: 0, updated: 0, errors: 0, message: "No null fields to fill — catalog is already complete for matched SKUs." });
    }

    // --- Run updates concurrently in batches of 20 ---
    let updated = 0, errors = 0;
    const CONCURRENCY = 20;
    for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
      const batch = toUpdate.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(({ id, patch }) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (svc.from("packing_sku_catalog" as any) as any).update(patch).eq("id", id)
        )
      );
      for (const r of results) {
        if (r.status === "fulfilled" && !r.value?.error) updated++;
        else errors++;
      }
    }

    return Response.json({
      ok: true,
      total: catalog.length,
      matched: toUpdate.length,
      updated,
      errors,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
