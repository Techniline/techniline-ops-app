import { fetchOrdersForSync, shopifyConfigured, type SyncOrder } from "@/lib/shopify/client";
import { authorizeLogistics } from "@/lib/logistics/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LAST_SYNC_KEY = "logistics_shopify_last_sync";
const DEFAULT_LOOKBACK_DAYS = 30;

/** Sync MusicMajlis Shopify orders into the logistics tables (deduped on Shopify order id). */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  if (!shopifyConfigured()) {
    return Response.json({ ok: false, error: "Shopify is not configured on the server." }, { status: 500 });
  }
  const svc = auth.serviceClient;

  // Window: explicit ?since / ?until (YYYY-MM-DD) drive a one-time historical
  // backfill (the client chunks it by month). Otherwise incremental from the
  // last successful sync (minus a small overlap), else a default lookback.
  const params = new URL(request.url).searchParams;
  const sinceParam = params.get("since");
  const untilParam = params.get("until");
  const windowed = !!sinceParam; // historical backfill — don't touch last-sync
  let sinceIso: string;
  // Historical backfill queries by created date; the incremental sync queries by
  // UPDATED date so orders that change later (fulfilled, paid, cancelled) get
  // re-pulled — Shopify's created-date window would never see those changes.
  const by: "created" | "updated" = windowed ? "created" : "updated";
  if (sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)) {
    sinceIso = new Date(`${sinceParam}T00:00:00Z`).toISOString();
  } else {
    const { data: setting } = await svc.from("app_settings").select("value").eq("key", LAST_SYNC_KEY).maybeSingle();
    const last = (setting as { value?: string | null } | null)?.value ?? null;
    // Cover at least the last 14 days of updated orders (self-heals recently
    // changed orders), going further back if the last sync is older than that.
    const sinceSinceLast = last ? new Date(last).getTime() - 6 * 3600 * 1000 : Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000;
    const minWindow = Date.now() - 14 * 24 * 3600 * 1000;
    sinceIso = new Date(Math.min(sinceSinceLast, minWindow)).toISOString();
  }
  const untilIso =
    untilParam && /^\d{4}-\d{2}-\d{2}$/.test(untilParam)
      ? new Date(`${untilParam}T00:00:00Z`).toISOString()
      : undefined;

  let orders: SyncOrder[];
  try {
    orders = await fetchOrdersForSync(sinceIso, untilIso, { by });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Shopify fetch failed.";
    await svc.from("logistics_api_error_logs").insert({ source: "shopify_sync", context: `since ${sinceIso}`, message });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const valid = orders.filter((o) => o.shopifyOrderId);
  const errors: string[] = [];
  let itemsUpserted = 0;

  // 1) Bulk upsert orders (one round-trip). logistics_status & tracking_number
  // are omitted so internal workflow state survives re-syncs.
  let idByShopify = new Map<string, string>();
  if (valid.length) {
    const orderRows = valid.map((o) => ({
      shopify_order_id: o.shopifyOrderId,
      order_number: o.orderNumber,
      shopify_created_at: o.shopifyCreatedAt,
      fulfillment_status: o.fulfillmentStatus,
      financial_status: o.financialStatus,
      customer_name: o.customerName,
      order_value: o.orderValue,
      currency: o.currency,
      payment_method: o.paymentMethod,
      shipping_phone: o.shippingPhone,
      shipping_method: o.shippingMethod,
      shipping_city: o.shippingCity,
      email: o.email,
      delivery_address: o.deliveryAddress,
      raw: o.raw as never,
      updated_at: nowIso,
    }));
    const { data: rows, error: oErr } = await svc
      .from("shopify_orders")
      .upsert(orderRows, { onConflict: "shopify_order_id" })
      .select("id, shopify_order_id");
    if (oErr) return Response.json({ ok: false, error: oErr.message }, { status: 500 });
    idByShopify = new Map((rows ?? []).map((r) => [(r as { shopify_order_id: string }).shopify_order_id, r.id]));
  }

  // 2) Bulk upsert all line items (one round-trip). Omit pick/pack/source so
  // internal state is preserved on re-sync.
  const itemRows = valid.flatMap((o) => {
    const orderId = idByShopify.get(o.shopifyOrderId);
    if (!orderId) return [];
    return o.items
      .filter((li) => li.shopifyLineId)
      .map((li) => ({
        order_id: orderId,
        shopify_line_id: li.shopifyLineId,
        title: li.title,
        sku: li.sku,
        brand: li.brand,
        qty_ordered: li.qty,
        unit_price: li.unitPrice,
        total_price: li.totalPrice,
        fulfilled_qty: li.fulfilledQty,
        updated_at: nowIso,
      }));
  });
  if (itemRows.length) {
    const { error: iErr } = await svc.from("shopify_order_items").upsert(itemRows, { onConflict: "shopify_line_id" });
    if (iErr) errors.push(`items: ${iErr.message}`);
    else itemsUpserted = itemRows.length;
  }

  // 3) Reflect Shopify's own order state automatically, in batched updates.
  const ids = (pred: (o: SyncOrder) => boolean) =>
    valid.filter(pred).map((o) => idByShopify.get(o.shopifyOrderId)).filter((x): x is string => !!x);

  // a) Canceled or Voided in Shopify → cancelled internally (overrides open
  //    states; this also triggers the SRT/PRT closure workflow). Skip ones
  //    already cancelled.
  const cancelledIds = ids(
    (o) => !!o.cancelledAt || (o.financialStatus ?? "").toLowerCase() === "voided"
  );
  if (cancelledIds.length) {
    await svc
      .from("shopify_orders")
      .update({ logistics_status: "cancelled", updated_at: nowIso })
      .in("id", cancelledIds)
      .neq("logistics_status", "cancelled");
  }

  // b) Archived/closed (and not cancelled) → treat as closed/fulfilled, never
  //    downgrading a more advanced state.
  const archivedIds = ids((o) => !!o.closedAt && !o.cancelledAt && (o.financialStatus ?? "").toLowerCase() !== "voided");
  if (archivedIds.length) {
    await svc
      .from("shopify_orders")
      .update({ logistics_status: "fulfilled_shopify", updated_at: nowIso })
      .in("id", archivedIds)
      .not("logistics_status", "in", "(fulfilled_shopify,out_for_delivery,delivered,cancelled)");
  }

  // c) Fulfilled in Shopify → fulfilled_shopify (not cancelled/closed already
  //    handled above; never downgrade).
  const fulfilledIds = ids(
    (o) => (o.fulfillmentStatus ?? "").toLowerCase() === "fulfilled" && !o.cancelledAt
  );
  if (fulfilledIds.length) {
    await svc
      .from("shopify_orders")
      .update({ logistics_status: "fulfilled_shopify", updated_at: nowIso })
      .in("id", fulfilledIds)
      .not("logistics_status", "in", "(fulfilled_shopify,out_for_delivery,delivered,cancelled)");
  }

  // Incremental syncs advance the last-sync marker; historical windows don't.
  if (!windowed) {
    await svc.from("app_settings").upsert({ key: LAST_SYNC_KEY, value: nowIso }, { onConflict: "key" });
  }
  if (errors.length) {
    await svc.from("logistics_api_error_logs").insert({
      source: "shopify_sync",
      context: `partial: ${errors.length} errors`,
      message: errors.slice(0, 10).join(" | "),
    });
  }

  return Response.json({
    ok: true,
    fetched: orders.length,
    ordersUpserted: idByShopify.size,
    itemsUpserted,
    errors: errors.length,
    lastSync: nowIso,
  });
}
