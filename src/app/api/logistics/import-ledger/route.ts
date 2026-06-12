import { authorizeLogistics } from "@/lib/logistics/serverAuth";
import { extractSNumber, parseLedger } from "@/lib/logistics/parseLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Backfill historical TLE invoice data from a MusicMajlis SIS ledger workbook.
 * Matches each ledger row's S-number (from the Comment) against an order's
 * order_number, and fills the invoice number + value where the order has none.
 * `dryRun` previews matches without writing. Manager/admin only.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = auth.serviceClient;

  // Bulk backfill is manager/admin only.
  const { data: me } = await svc.from("users").select("role").eq("id", auth.uid).maybeSingle();
  const role = (me as { role?: string } | null)?.role;
  if (role !== "manager" && role !== "admin") {
    return Response.json({ ok: false, error: "Manager access required for ledger import." }, { status: 403 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("apply") !== "1";

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

  let entries;
  try {
    entries = parseLedger(bytes);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not parse the ledger." },
      { status: 400 }
    );
  }
  if (entries.length === 0) {
    return Response.json({ ok: false, error: "No rows with an S-number found in the ledger." }, { status: 400 });
  }

  const ledgerBySnum = new Map(entries.map((e) => [e.snum, e]));

  // Pull all orders and index by the S-number embedded in their order_number.
  const { data: orders, error } = await svc
    .from("shopify_orders")
    .select("id, order_number, order_value, tle_invoice_number");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const ordersBySnum = new Map<string, { id: string; order_value: number | null; hasInvoice: boolean }>();
  for (const o of orders ?? []) {
    const sn = extractSNumber((o as { order_number: string | null }).order_number);
    if (sn && !ordersBySnum.has(sn)) {
      ordersBySnum.set(sn, {
        id: o.id,
        order_value: o.order_value,
        hasInvoice: !!o.tle_invoice_number,
      });
    }
  }

  const toFill: {
    id: string;
    snum: string;
    invoiceNo: string | null;
    netAmount: number | null;
    valueMatches: boolean;
  }[] = [];
  let alreadyHad = 0;
  const unmatched: string[] = [];

  for (const [snum, e] of ledgerBySnum) {
    const o = ordersBySnum.get(snum);
    if (!o) {
      unmatched.push(snum);
      continue;
    }
    if (o.hasInvoice) {
      alreadyHad += 1;
      continue;
    }
    const valueMatches =
      e.netAmount != null && o.order_value != null && Math.abs(e.netAmount - o.order_value) <= 0.01;
    toFill.push({ id: o.id, snum, invoiceNo: e.invoiceNo, netAmount: e.netAmount, valueMatches });
  }

  const summary = {
    ledgerRows: entries.length,
    ordersInSystem: ordersBySnum.size,
    willFill: toFill.length,
    alreadyHadInvoice: alreadyHad,
    unmatchedLedger: unmatched.length,
    valueMismatches: toFill.filter((t) => !t.valueMatches).length,
    sampleUnmatched: unmatched.slice(0, 15),
    sampleFill: toFill.slice(0, 15).map((t) => ({ snum: t.snum, invoiceNo: t.invoiceNo, netAmount: t.netAmount, valueMatches: t.valueMatches })),
  };

  if (dryRun) {
    return Response.json({ ok: true, dryRun: true, summary });
  }

  // Apply. Value match → verified; mismatch → left unverified with a remark so it surfaces for review.
  const nowIso = new Date().toISOString();
  let filled = 0;
  for (const t of toFill) {
    const remark = t.valueMatches
      ? "Backfilled from sales ledger."
      : `Backfilled from sales ledger — value differs (ledger ${t.netAmount ?? "—"}). Please review.`;
    const { error: uErr } = await svc
      .from("shopify_orders")
      .update({
        tle_invoice_number: t.invoiceNo,
        invoice_value: t.netAmount,
        invoice_remarks: remark,
        invoice_verified: t.valueMatches,
        invoice_checked_by: auth.uid,
        invoice_checked_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", t.id);
    if (!uErr) filled += 1;
  }

  await svc.from("logistics_activity_logs").insert({
    entity_type: "order",
    action: "ledger_import",
    new_value: `${filled} invoices backfilled`,
    notes: `From sales ledger: ${summary.willFill} matched, ${summary.unmatchedLedger} unmatched.`,
    user_id: auth.uid,
  });

  return Response.json({ ok: true, dryRun: false, filled, summary });
}
