import { authorizeLogistics } from "@/lib/logistics/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "new_order",
  "checking_stock",
  "awaiting_branch",
  "prt_requested",
  "ready_to_dispatch",
  "tracking_pending",
  "tracking_updated",
  "fulfilled_shopify",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "issue_hold",
]);

const VALID_PICKING = new Set([
  "not_checked",
  "available",
  "requested",
  "picked",
  "packed",
  "not_available",
  "issue",
]);

const VALID_SOURCES = new Set(["warehouse", "hq", "al_shoala", "soundline", "other"]);

/**
 * Mutations for the order workflow:
 *  - { action: "set_status", orderId, status, note? }
 *  - { action: "update_item", itemId, orderId, picked?, packed?, picking_status?, source_location? }
 * Enforces: can't move to "ready_to_dispatch" unless every line is picked & packed.
 * Logs status changes to the activity log.
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

  const action = typeof b.action === "string" ? b.action : "";

  if (action === "set_status") {
    const orderId = typeof b.orderId === "string" ? b.orderId : "";
    const status = typeof b.status === "string" ? b.status : "";
    const note = typeof b.note === "string" ? b.note.trim() || null : null;
    if (!orderId || !VALID_STATUSES.has(status)) {
      return Response.json({ ok: false, error: "Invalid order or status." }, { status: 400 });
    }

    const { data: order, error } = await svc
      .from("shopify_orders")
      .select("id, order_number, logistics_status")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !order) return Response.json({ ok: false, error: "Order not found." }, { status: 404 });

    if (status === "ready_to_dispatch") {
      const { data: items } = await svc
        .from("shopify_order_items")
        .select("picked, packed")
        .eq("order_id", orderId);
      const lines = items ?? [];
      const unready = lines.filter((li) => !li.picked || !li.packed);
      if (lines.length === 0 || unready.length > 0) {
        return Response.json(
          { ok: false, error: "Every line item must be picked and packed before Ready to Dispatch." },
          { status: 400 }
        );
      }
    }

    const prev = (order as { logistics_status: string }).logistics_status;
    const orderNumber = (order as { order_number: string | null }).order_number;
    const { error: uErr } = await svc
      .from("shopify_orders")
      .update({ logistics_status: status, updated_at: new Date().toISOString() })
      .eq("id", orderId);
    if (uErr) return Response.json({ ok: false, error: uErr.message }, { status: 500 });

    await svc.from("logistics_activity_logs").insert({
      entity_type: "order",
      entity_id: orderId,
      order_number: orderNumber,
      action: "status_change",
      old_value: prev,
      new_value: status,
      notes: note,
      user_id: auth.uid,
    });
    return Response.json({ ok: true });
  }

  if (action === "update_item") {
    const itemId = typeof b.itemId === "string" ? b.itemId : "";
    if (!itemId) return Response.json({ ok: false, error: "Missing item." }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.picked === "boolean") patch.picked = b.picked;
    if (typeof b.packed === "boolean") patch.packed = b.packed;
    if (typeof b.picking_status === "string") {
      if (!VALID_PICKING.has(b.picking_status)) {
        return Response.json({ ok: false, error: "Invalid picking status." }, { status: 400 });
      }
      patch.picking_status = b.picking_status;
    }
    if (typeof b.source_location === "string") {
      if (!VALID_SOURCES.has(b.source_location)) {
        return Response.json({ ok: false, error: "Invalid source location." }, { status: 400 });
      }
      patch.source_location = b.source_location;
    }

    const { error } = await svc.from("shopify_order_items").update(patch).eq("id", itemId);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
