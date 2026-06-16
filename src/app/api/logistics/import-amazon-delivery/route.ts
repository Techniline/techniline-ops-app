import { authorizeLogistics } from "@/lib/logistics/serverAuth";
import { parseAmazonDelivery, type AmazonDeliveryRecord } from "@/lib/logistics/parseAmazonDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Managers/admin + Maricel & Kesh (the return-doc editors) may run this import. */
const DOC_EDITORS = new Set([
  "227fdb27-80b5-4040-ab14-4bb945068af7", // Maricel
  "4f0eaff3-3ce3-44de-8ed9-aa84246fc538", // Kesh
]);

type DocRow = {
  amazon_order_id: string;
  invoice_number: string | null;
  prt_number: string | null;
  srt_number: string | null;
  delivery_status: string | null;
  delivery_date: string | null;
  amazon_return_date: string | null;
  tracking_number: string | null;
  delivery_charge: number | null;
  delivery_address: string | null;
};

/**
 * Backfill operational delivery + return data from the "Amazon Seller Delivery
 * List" workbook into seller_order_docs (a SEPARATE table from the API-synced
 * seller_orders, which is never touched). Matches rows by Amazon order id.
 *  - Delivery fields (status/date/return date/tracking/charge/address) are set
 *    from the sheet (the operational source of truth).
 *  - PRT / SRT are filled only when empty — manual entries are preserved.
 * `dryRun` (default) previews without writing. Manager/admin or Maricel/Kesh only.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = auth.serviceClient;

  const { data: me } = await svc.from("users").select("role").eq("id", auth.uid).maybeSingle();
  const role = (me as { role?: string } | null)?.role;
  if (!(role === "manager" || role === "admin" || DOC_EDITORS.has(auth.uid))) {
    return Response.json({ ok: false, error: "Manager or return-doc editor access required." }, { status: 403 });
  }

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

  let parsed;
  try {
    parsed = parseAmazonDelivery(bytes);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Could not parse the workbook." }, { status: 400 });
  }
  const { records, rowsBySheet } = parsed;
  if (records.length === 0) {
    return Response.json({ ok: false, error: "No rows with an Amazon order id found in the workbook." }, { status: 400 });
  }

  // Index the synced orders (read-only) so we only write docs for real orders.
  const { data: orders, error: oErr } = await svc.from("seller_orders").select("amazon_order_id");
  if (oErr) return Response.json({ ok: false, error: oErr.message }, { status: 500 });
  const known = new Set((orders ?? []).map((o) => (o as { amazon_order_id: string }).amazon_order_id));

  // Existing docs so PRT/SRT/invoice fill-only-when-empty and we can diff.
  const { data: docRows } = await svc
    .from("seller_order_docs")
    .select("amazon_order_id, invoice_number, prt_number, srt_number, delivery_status, delivery_date, amazon_return_date, tracking_number, delivery_charge, delivery_address");
  const docs = new Map<string, DocRow>();
  for (const d of (docRows ?? []) as DocRow[]) docs.set(d.amazon_order_id, d);

  type Patch = { amazon_order_id: string } & Partial<DocRow>;
  const toWrite: Patch[] = [];
  const unmatchedBySheet: Record<string, number> = {};
  const sampleUnmatched: string[] = [];

  const fillEmpty = (existing: string | null | undefined, incoming: string | null) =>
    existing && existing.trim() !== "" ? undefined : incoming ?? undefined;

  for (const rec of records) {
    if (!known.has(rec.orderId)) {
      unmatchedBySheet[rec.sheet] = (unmatchedBySheet[rec.sheet] ?? 0) + 1;
      if (sampleUnmatched.length < 15) sampleUnmatched.push(`${rec.orderId} (${rec.sheet})`);
      continue;
    }
    const cur = docs.get(rec.orderId);
    const patch: Patch = { amazon_order_id: rec.orderId };
    // Delivery fields — source of truth = the sheet.
    if (rec.deliveryStatus != null) patch.delivery_status = rec.deliveryStatus;
    if (rec.deliveryDate != null) patch.delivery_date = rec.deliveryDate;
    if (rec.returnDate != null) patch.amazon_return_date = rec.returnDate;
    if (rec.trackingNo != null) patch.tracking_number = rec.trackingNo;
    if (rec.deliveryCharge != null) patch.delivery_charge = rec.deliveryCharge;
    if (rec.deliveryAddress != null) patch.delivery_address = rec.deliveryAddress;
    // PRT / SRT — fill only when empty (preserve manual entries).
    const prt = fillEmpty(cur?.prt_number, rec.prt);
    const srt = fillEmpty(cur?.srt_number, rec.srt);
    if (prt !== undefined) patch.prt_number = prt;
    if (srt !== undefined) patch.srt_number = srt;

    // Only write if there's at least one field beyond the key.
    if (Object.keys(patch).length > 1) toWrite.push(patch);
  }

  const summary = {
    rowsBySheet,
    distinctOrders: records.length,
    ordersInSystem: known.size,
    matched: records.length - Object.values(unmatchedBySheet).reduce((a, b) => a + b, 0),
    willWrite: toWrite.length,
    unmatchedBySheet,
    sampleUnmatched,
    sampleWrite: toWrite.slice(0, 15),
  };

  if (dryRun) return Response.json({ ok: true, dryRun: true, summary });

  const nowIso = new Date().toISOString();
  let written = 0;
  for (const p of toWrite) {
    const { error } = await svc
      .from("seller_order_docs")
      .upsert({ ...p, updated_by: auth.uid, updated_at: nowIso } as never, { onConflict: "amazon_order_id" });
    if (!error) written += 1;
  }

  await svc.from("logistics_activity_logs").insert({
    entity_type: "amazon_order",
    action: "delivery_list_import",
    new_value: `${written} order docs updated`,
    notes: `Amazon delivery list: ${summary.matched} matched, ${summary.willWrite} written, ${summary.sampleUnmatched.length ? Object.values(unmatchedBySheet).reduce((a, b) => a + b, 0) : 0} unmatched.`,
    user_id: auth.uid,
  });

  return Response.json({ ok: true, dryRun: false, written, summary });
}
