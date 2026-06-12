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

  // Window: an explicit ?since=YYYY-MM-DD (one-time historical backfill) wins;
  // otherwise from the last successful sync (minus a small overlap), else lookback.
  const sinceParam = new URL(request.url).searchParams.get("since");
  let sinceIso: string;
  if (sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)) {
    sinceIso = new Date(`${sinceParam}T00:00:00Z`).toISOString();
  } else {
    const { data: setting } = await svc.from("app_settings").select("value").eq("key", LAST_SYNC_KEY).maybeSingle();
    const last = (setting as { value?: string | null } | null)?.value ?? null;
    if (last) {
      // Re-fetch a 6h overlap so edits near the boundary aren't missed.
      sinceIso = new Date(new Date(last).getTime() - 6 * 3600 * 1000).toISOString();
    } else {
      sinceIso = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
    }
  }

  let orders: SyncOrder[];
  try {
    orders = await fetchOrdersForSync(sinceIso);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Shopify fetch failed.";
    await svc.from("logistics_api_error_logs").insert({
      source: "shopify_sync",
      context: `since ${sinceIso}`,
      message,
    });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }

  let upserted = 0;
  let itemsUpserted = 0;
  const errors: string[] = [];

  for (const o of orders) {
    if (!o.shopifyOrderId) continue;
    // Upsert the order. logistics_status & tracking_number are intentionally
    // omitted so internal workflow state survives re-syncs.
    const { data: row, error: oErr } = await svc
      .from("shopify_orders")
      .upsert(
        {
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
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shopify_order_id" }
      )
      .select("id")
      .maybeSingle();

    if (oErr || !row) {
      errors.push(`${o.orderNumber ?? o.shopifyOrderId}: ${oErr?.message ?? "no id returned"}`);
      continue;
    }
    upserted += 1;
    const orderId = (row as { id: string }).id;

    // Bidirectional: if Shopify already marks the order fulfilled, reflect that
    // internally — unless it has moved further along (out for delivery/delivered)
    // or been cancelled. Never downgrade a more advanced internal status.
    if ((o.fulfillmentStatus ?? "").toLowerCase() === "fulfilled") {
      await svc
        .from("shopify_orders")
        .update({ logistics_status: "fulfilled_shopify", updated_at: new Date().toISOString() })
        .eq("id", orderId)
        .not("logistics_status", "in", "(fulfilled_shopify,out_for_delivery,delivered,cancelled)");
    }

    if (o.items.length) {
      // Upsert line items on shopify_line_id; omit picked/packed/picking_status/
      // source_location so internal state is preserved.
      const itemRows = o.items
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
          updated_at: new Date().toISOString(),
        }));
      const { error: iErr } = await svc
        .from("shopify_order_items")
        .upsert(itemRows, { onConflict: "shopify_line_id" });
      if (iErr) errors.push(`${o.orderNumber ?? o.shopifyOrderId} items: ${iErr.message}`);
      else itemsUpserted += itemRows.length;
    }
  }

  const now = new Date().toISOString();
  await svc.from("app_settings").upsert({ key: LAST_SYNC_KEY, value: now }, { onConflict: "key" });

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
    ordersUpserted: upserted,
    itemsUpserted,
    errors: errors.length,
    lastSync: now,
  });
}
