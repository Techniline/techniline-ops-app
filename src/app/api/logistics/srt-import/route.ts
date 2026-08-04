import * as XLSX from "xlsx";

import { authorizeLogistics } from "@/lib/logistics/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Amazon order ID format: 3 digits - 7 digits - 7 digits
const ORDER_ID_RE = /\b(\d{3}-\d{7}-\d{7})\b/;

interface SrtRow {
  srtNumber: string;
  orderId: string;
}

function parseSrtExcel(bytes: Uint8Array): SrtRow[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("No sheet found in the workbook.");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const results: SrtRow[] = [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const srtRaw = String(row[0] ?? "").trim();
    if (!srtRaw.startsWith("SRT/")) continue;

    const comment = String(row[8] ?? "").trim(); // column I (0-indexed = 8)
    const match = ORDER_ID_RE.exec(comment);
    if (!match) continue;

    results.push({ srtNumber: srtRaw, orderId: match[1] });
  }

  return results;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const dryRun = new URL(request.url).searchParams.get("apply") !== "1";

  let bytes: Uint8Array;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
    if (file.size > 25_000_000) return Response.json({ ok: false, error: "File too large (max 25 MB)." }, { status: 413 });
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return Response.json({ ok: false, error: "Could not read the upload." }, { status: 400 });
  }

  let rows: SrtRow[];
  try {
    rows = parseSrtExcel(bytes);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Parse error." }, { status: 422 });
  }

  if (rows.length === 0) {
    return Response.json({ ok: false, error: "No SRT rows with order IDs found in the file." }, { status: 422 });
  }

  const svc = auth.serviceClient;
  const orderIds = rows.map((r) => r.orderId);

  // Find matching marketplace_returns by order_ref
  const { data: existing } = await svc
    .from("marketplace_returns")
    .select("id, order_ref, srt_number")
    .in("order_ref", orderIds);

  // Map order_ref → [record ids] (one order can have multiple return rows)
  const byOrder = new Map<string, { id: string; srt_number: string | null }[]>();
  for (const rec of (existing ?? []) as { id: string; order_ref: string | null; srt_number: string | null }[]) {
    if (!rec.order_ref) continue;
    if (!byOrder.has(rec.order_ref)) byOrder.set(rec.order_ref, []);
    byOrder.get(rec.order_ref)!.push(rec);
  }

  let willUpdate = 0;
  let alreadySet = 0;
  let notFound = 0;

  for (const row of rows) {
    const matches = byOrder.get(row.orderId);
    if (!matches || matches.length === 0) { notFound++; continue; }
    for (const rec of matches) {
      if (rec.srt_number) { alreadySet++; continue; }
      willUpdate++;
    }
  }

  if (dryRun) {
    return Response.json({ ok: true, dryRun: true, willUpdate, alreadySet, notFound, total: rows.length });
  }

  let updated = 0;
  for (const row of rows) {
    const matches = byOrder.get(row.orderId);
    if (!matches) continue;
    for (const rec of matches) {
      if (rec.srt_number) continue;
      const { error } = await svc
        .from("marketplace_returns")
        .update({ srt_number: row.srtNumber })
        .eq("id", rec.id);
      if (!error) updated++;
    }
  }

  return Response.json({ ok: true, dryRun: false, updated, alreadySet, notFound, total: rows.length });
}
