import { authorizeLogistics } from "@/lib/logistics/serverAuth";
import { parseAmazonInvoices } from "@/lib/logistics/parseAmazonInvoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DOC_EDITORS = new Set([
  "227fdb27-80b5-4040-ab14-4bb945068af7", // Maricel
  "4f0eaff3-3ce3-44de-8ed9-aa84246fc538", // Kesh
]);

/**
 * Fill Amazon order invoice numbers from the SIS Ledger (ERP export). Matches the
 * Comment (Amazon order id) to a synced seller_order, and writes the Inv No into
 * seller_order_docs.invoice_number — fill-only-when-empty so manual entries are
 * preserved. The API-synced seller_orders is never touched. dryRun previews.
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
    parsed = parseAmazonInvoices(bytes);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Could not parse the ledger." }, { status: 400 });
  }
  if (parsed.records.length === 0) {
    return Response.json({ ok: false, error: "No rows with an Amazon order id + invoice number found." }, { status: 400 });
  }

  const { data: orders, error: oErr } = await svc.from("seller_orders").select("amazon_order_id");
  if (oErr) return Response.json({ ok: false, error: oErr.message }, { status: 500 });
  const known = new Set((orders ?? []).map((o) => (o as { amazon_order_id: string }).amazon_order_id));

  const { data: docRows } = await svc.from("seller_order_docs").select("amazon_order_id, invoice_number");
  const existingInvoice = new Map<string, string | null>();
  for (const d of (docRows ?? []) as { amazon_order_id: string; invoice_number: string | null }[]) {
    existingInvoice.set(d.amazon_order_id, d.invoice_number);
  }

  const toWrite: { amazon_order_id: string; invoice_number: string }[] = [];
  let alreadyHad = 0;
  const unmatched: string[] = [];
  for (const rec of parsed.records) {
    if (!known.has(rec.orderId)) { unmatched.push(rec.orderId); continue; }
    const cur = existingInvoice.get(rec.orderId);
    if (cur && cur.trim() !== "") { alreadyHad += 1; continue; } // preserve manual entry
    toWrite.push({ amazon_order_id: rec.orderId, invoice_number: rec.invoiceNo });
  }

  const summary = {
    ledgerRows: parsed.rows,
    distinctOrders: parsed.records.length,
    ordersInSystem: known.size,
    matched: parsed.records.length - unmatched.length,
    willFill: toWrite.length,
    alreadyHad,
    unmatched: unmatched.length,
    sampleUnmatched: unmatched.slice(0, 12),
    sampleFill: toWrite.slice(0, 12),
  };

  if (dryRun) return Response.json({ ok: true, dryRun: true, summary });

  const nowIso = new Date().toISOString();
  let filled = 0;
  let firstError: string | null = null;
  for (const w of toWrite) {
    const { error } = await svc
      .from("seller_order_docs")
      .upsert({ ...w, updated_by: auth.uid, updated_at: nowIso } as never, { onConflict: "amazon_order_id" });
    if (!error) filled += 1;
    else if (!firstError) firstError = error.message;
  }
  if (filled === 0 && firstError) {
    return Response.json({ ok: false, error: `Write failed: ${firstError}` }, { status: 500 });
  }

  await svc.from("logistics_activity_logs").insert({
    entity_type: "amazon_order",
    action: "invoice_import",
    new_value: `${filled} invoice numbers filled`,
    notes: `From SIS ledger: ${summary.matched} matched, ${summary.willFill} filled, ${summary.unmatched} unmatched.`,
    user_id: auth.uid,
  });

  return Response.json({ ok: true, dryRun: false, filled, summary });
}
