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

  if (action === "save_invoice") {
    const orderId = typeof b.orderId === "string" ? b.orderId : "";
    const tle = typeof b.tleInvoiceNumber === "string" ? b.tleInvoiceNumber.trim() : "";
    const invoiceValue = typeof b.invoiceValue === "number" ? b.invoiceValue : null;
    const invoicedSkus = typeof b.invoicedSkus === "string" ? b.invoicedSkus.trim() : "";
    const remarks = typeof b.remarks === "string" ? b.remarks.trim() : "";
    if (!orderId) return Response.json({ ok: false, error: "Missing order." }, { status: 400 });
    if (!tle) return Response.json({ ok: false, error: "A TLE invoice number is required." }, { status: 400 });

    const { data: order, error } = await svc
      .from("shopify_orders")
      .select("id, order_number, order_value")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !order) return Response.json({ ok: false, error: "Order not found." }, { status: 404 });

    const { data: items } = await svc.from("shopify_order_items").select("sku").eq("order_id", orderId);
    const orderSkus = new Set(
      (items ?? []).map((i) => (i.sku ?? "").trim().toUpperCase()).filter(Boolean)
    );

    const orderValue = (order as { order_value: number | null }).order_value;
    const valueMismatch =
      invoiceValue != null && orderValue != null && Math.abs(invoiceValue - orderValue) > 0.01;

    let skuMismatch = false;
    const missingSkus: string[] = []; // in order, not invoiced
    const extraSkus: string[] = []; // invoiced, not in order
    if (invoicedSkus) {
      const invSet = new Set(
        invoicedSkus
          .split(/[\s,;]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      );
      for (const s of orderSkus) if (!invSet.has(s)) missingSkus.push(s);
      for (const s of invSet) if (!orderSkus.has(s)) extraSkus.push(s);
      skuMismatch = missingSkus.length > 0 || extraSkus.length > 0;
    }

    if ((valueMismatch || skuMismatch) && !remarks) {
      return Response.json(
        {
          ok: false,
          error: "Mismatch detected — remarks are mandatory to complete this record.",
          valueMismatch,
          skuMismatch,
          missingSkus,
          extraSkus,
          orderValue,
        },
        { status: 400 }
      );
    }

    const { error: uErr } = await svc
      .from("shopify_orders")
      .update({
        tle_invoice_number: tle,
        invoice_value: invoiceValue,
        invoiced_skus: invoicedSkus || null,
        invoice_remarks: remarks || null,
        invoice_verified: true,
        invoice_checked_by: auth.uid,
        invoice_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    if (uErr) return Response.json({ ok: false, error: uErr.message }, { status: 500 });

    await svc.from("logistics_activity_logs").insert({
      entity_type: "order",
      entity_id: orderId,
      order_number: (order as { order_number: string | null }).order_number,
      action: "invoice_verified",
      new_value: tle,
      notes:
        valueMismatch || skuMismatch
          ? `Mismatch acknowledged — ${remarks}`
          : "Invoice matched order.",
      user_id: auth.uid,
    });
    return Response.json({ ok: true, valueMismatch, skuMismatch, missingSkus, extraSkus });
  }

  if (action === "close_cancellation") {
    const orderId = typeof b.orderId === "string" ? b.orderId : "";
    const srt = typeof b.srtNumber === "string" ? b.srtNumber.trim() : "";
    const prt = typeof b.prtNumber === "string" ? b.prtNumber.trim() : "";
    if (!orderId) return Response.json({ ok: false, error: "Missing order." }, { status: 400 });
    if (!srt || !prt) {
      return Response.json(
        { ok: false, error: "Both SRT and PRT document numbers are required to close a cancelled order." },
        { status: 400 }
      );
    }
    const { data: order, error } = await svc
      .from("shopify_orders")
      .select("id, order_number, logistics_status")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !order) return Response.json({ ok: false, error: "Order not found." }, { status: 404 });

    const { error: uErr } = await svc
      .from("shopify_orders")
      .update({ srt_number: srt, prt_number: prt, cancellation_closed: true, updated_at: new Date().toISOString() })
      .eq("id", orderId);
    if (uErr) return Response.json({ ok: false, error: uErr.message }, { status: 500 });

    await svc.from("logistics_activity_logs").insert({
      entity_type: "order",
      entity_id: orderId,
      order_number: (order as { order_number: string | null }).order_number,
      action: "cancellation_closed",
      new_value: `SRT ${srt} / PRT ${prt}`,
      notes: "Cancelled order closed with SRT & PRT document numbers.",
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
