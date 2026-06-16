import { authorizeLogistics } from "@/lib/logistics/serverAuth";
import { parseAmazonReturns } from "@/lib/logistics/parseAmazonDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Managers/admin + Maricel & Kesh (return-doc editors). */
const DOC_EDITORS = new Set([
  "227fdb27-80b5-4040-ab14-4bb945068af7", // Maricel
  "4f0eaff3-3ce3-44de-8ed9-aa84246fc538", // Kesh
]);

/**
 * Log the RETURN rows from the Amazon Seller Delivery List workbook into
 * marketplace_returns, channelled by sheet (Easy Ship / Self Ship / Amazon DF).
 * Imported as historical, already-handled records: physical_status "received",
 * doc_status "closed" (keeps Maricel's pending queue clean). De-duped on
 * (channel, order_ref, sku) so re-importing won't create duplicates.
 * `dryRun` (default) previews. Manager/admin or Maricel/Kesh only.
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

  let records;
  try {
    records = parseAmazonReturns(bytes);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Could not parse the workbook." }, { status: 400 });
  }
  if (records.length === 0) {
    return Response.json({ ok: false, error: "No return rows found (no return date / PRT / SRT / cancelled status)." }, { status: 400 });
  }

  // De-dupe against what's already logged.
  const { data: existing } = await svc.from("marketplace_returns").select("channel, order_ref, sku");
  const seen = new Set(
    (existing ?? []).map((e) => {
      const x = e as { channel: string | null; order_ref: string | null; sku: string | null };
      return `${x.channel ?? ""}|${x.order_ref ?? ""}|${x.sku ?? ""}`;
    })
  );

  const byChannel: Record<string, number> = {};
  const toInsert: Record<string, unknown>[] = [];
  let alreadyExists = 0;
  for (const rec of records) {
    byChannel[rec.channel] = (byChannel[rec.channel] ?? 0) + 1;
    const key = `${rec.channel}|${rec.orderId}|${rec.sku ?? ""}`;
    if (seen.has(key)) { alreadyExists += 1; continue; }
    seen.add(key); // also de-dupe within this file
    toInsert.push({
      channel: rec.channel,
      order_ref: rec.orderId,
      sku: rec.sku,
      qty: rec.qty,
      received_date: rec.receivedDate,
      prt_number: rec.prt,
      srt_number: rec.srt,
      tracking_number: rec.tracking,
      reason: "customer_return",
      physical_status: "received",
      doc_status: "closed",
      location: "warehouse",
      notes: rec.note ?? "Imported from Amazon delivery list.",
      logged_by: auth.uid,
      documented_by: auth.uid,
    });
  }

  const summary = {
    returnRows: records.length,
    byChannel,
    willInsert: toInsert.length,
    alreadyExists,
    sample: toInsert.slice(0, 12).map((t) => ({ channel: t.channel, order_ref: t.order_ref, sku: t.sku, received_date: t.received_date })),
  };

  if (dryRun) return Response.json({ ok: true, dryRun: true, summary });

  let inserted = 0;
  let firstError: string | null = null;
  // Insert in chunks to keep requests small.
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { error, count } = await svc.from("marketplace_returns").insert(chunk as never, { count: "exact" });
    if (error) { if (!firstError) firstError = error.message; }
    else inserted += count ?? chunk.length;
  }

  if (inserted === 0 && firstError) {
    return Response.json({ ok: false, error: `Insert failed: ${firstError}` }, { status: 500 });
  }

  await svc.from("logistics_activity_logs").insert({
    entity_type: "marketplace_return",
    action: "delivery_list_return_import",
    new_value: `${inserted} returns logged`,
    notes: `From Amazon delivery list: ${summary.willInsert} new, ${alreadyExists} already logged.`,
    user_id: auth.uid,
  });

  return Response.json({ ok: true, dryRun: false, inserted, summary });
}
