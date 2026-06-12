import { pushFulfillment, shopifyConfigured } from "@/lib/shopify/client";
import { authorizeLogistics } from "@/lib/logistics/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validate, save tracking internally, then push fulfillment + tracking to Shopify.
 * Rules: all line items must be picked & packed; a tracking number is required.
 * On Shopify failure the internal tracking record is kept (with the error) so the
 * user can retry, and the failure is logged.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = auth.serviceClient;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const orderId = typeof b.orderId === "string" ? b.orderId : "";
  const courier = typeof b.courier === "string" ? b.courier.trim() || null : null;
  const trackingNumber = typeof b.trackingNumber === "string" ? b.trackingNumber.trim() : "";
  const trackingUrl = typeof b.trackingUrl === "string" ? b.trackingUrl.trim() || null : null;
  const dispatchDate = typeof b.dispatchDate === "string" ? b.dispatchDate || null : null;
  const deliveryNotes = typeof b.deliveryNotes === "string" ? b.deliveryNotes.trim() || null : null;
  const notify = b.notify === true;

  if (!orderId) return Response.json({ ok: false, error: "Missing order." }, { status: 400 });
  if (!trackingNumber) {
    return Response.json({ ok: false, error: "A tracking number is required before fulfilling." }, { status: 400 });
  }

  const { data: order, error: oErr } = await svc
    .from("shopify_orders")
    .select("id, shopify_order_id, order_number, logistics_status")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr || !order) return Response.json({ ok: false, error: "Order not found." }, { status: 404 });

  const { data: items } = await svc
    .from("shopify_order_items")
    .select("title, picked, packed")
    .eq("order_id", orderId);
  const lines = items ?? [];
  if (lines.length === 0) {
    return Response.json({ ok: false, error: "Order has no line items to fulfill." }, { status: 400 });
  }
  const unready = lines.filter((li) => !li.picked || !li.packed);
  if (unready.length > 0) {
    return Response.json(
      { ok: false, error: `All items must be picked and packed first (${unready.length} pending).` },
      { status: 400 }
    );
  }

  if (!shopifyConfigured()) {
    return Response.json({ ok: false, error: "Shopify is not configured on the server." }, { status: 500 });
  }

  const orderNumber = (order as { order_number: string | null }).order_number;
  const shopifyOrderId = (order as { shopify_order_id: string }).shopify_order_id;
  const nowIso = new Date().toISOString();

  // Save the tracking record internally first (so nothing is lost if Shopify fails).
  const { data: tracking } = await svc
    .from("tracking_updates")
    .insert({
      order_id: orderId,
      courier,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      dispatch_date: dispatchDate,
      delivery_notes: deliveryNotes,
      pushed_to_shopify: false,
      created_by: auth.uid,
    })
    .select("id")
    .maybeSingle();
  const trackingId = (tracking as { id: string } | null)?.id ?? null;

  // Push to Shopify.
  const result = await pushFulfillment(shopifyOrderId, {
    number: trackingNumber,
    url: trackingUrl,
    company: courier,
    notify,
  });

  if (!result.ok) {
    if (trackingId) {
      await svc.from("tracking_updates").update({ shopify_error: result.message }).eq("id", trackingId);
    }
    // Keep internal record; mark order as tracking_updated (saved, not yet in Shopify).
    await svc
      .from("shopify_orders")
      .update({ tracking_number: trackingNumber, logistics_status: "tracking_updated", updated_at: nowIso })
      .eq("id", orderId);
    await svc.from("logistics_api_error_logs").insert({
      source: "shopify_fulfillment",
      context: orderNumber ?? shopifyOrderId,
      message: result.message,
    });
    await svc.from("logistics_activity_logs").insert({
      entity_type: "order",
      entity_id: orderId,
      order_number: orderNumber,
      action: "fulfillment_failed",
      new_value: trackingNumber,
      notes: result.message,
      user_id: auth.uid,
    });
    return Response.json(
      { ok: false, error: `Saved internally, but Shopify push failed: ${result.message}`, retryable: true },
      { status: 502 }
    );
  }

  // Success: mark pushed, fulfill the order, log it.
  if (trackingId) {
    await svc.from("tracking_updates").update({ pushed_to_shopify: true }).eq("id", trackingId);
  }
  await svc
    .from("shopify_orders")
    .update({
      tracking_number: trackingNumber,
      fulfillment_status: "fulfilled",
      logistics_status: "fulfilled_shopify",
      updated_at: nowIso,
    })
    .eq("id", orderId);
  await svc.from("logistics_activity_logs").insert({
    entity_type: "order",
    entity_id: orderId,
    order_number: orderNumber,
    action: "fulfilled_shopify",
    new_value: trackingNumber,
    notes: courier ? `Courier: ${courier}` : null,
    user_id: auth.uid,
  });

  return Response.json({ ok: true, fulfillmentId: result.fulfillmentId });
}
