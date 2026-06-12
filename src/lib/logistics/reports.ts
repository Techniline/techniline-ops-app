import { supabase } from "@/lib/supabaseClient";

const PENDING = [
  "new_order",
  "checking_stock",
  "awaiting_branch",
  "prt_requested",
  "ready_to_dispatch",
  "tracking_pending",
];

export interface DelayRow {
  id: string;
  kind: "Order" | "Reseller";
  orderNumber: string | null;
  customer: string | null;
  status: string;
  city: string | null;
  createdAt: string | null;
  hoursOpen: number;
}

const OPEN_RESELLER = ["new", "preparing", "ready", "out_for_delivery", "issue"];

/**
 * Pending Shopify orders (delay from creation) + reseller deliveries overdue
 * against their scheduled date (delay from the scheduled date). Sorted by the
 * longest delay first.
 */
export async function delayReport(): Promise<DelayRow[]> {
  const now = Date.now();
  const todayDate = new Date(now).toISOString().slice(0, 10);

  const [{ data: orders, error }, { data: resellers }] = await Promise.all([
    supabase
      .from("shopify_orders")
      .select("id, order_number, customer_name, logistics_status, shipping_city, shopify_created_at")
      .in("logistics_status", PENDING)
      .limit(500),
    supabase
      .from("reseller_deliveries")
      .select("id, reseller_name, reference_no, status, city, scheduled_date")
      .in("status", OPEN_RESELLER)
      .lt("scheduled_date", todayDate)
      .limit(500),
  ]);
  if (error) throw new Error(error.message);

  const orderRows: DelayRow[] = (orders ?? []).map((o) => {
    const created = o.shopify_created_at ? new Date(o.shopify_created_at).getTime() : now;
    return {
      id: o.id,
      kind: "Order",
      orderNumber: o.order_number,
      customer: o.customer_name,
      status: o.logistics_status,
      city: o.shipping_city,
      createdAt: o.shopify_created_at,
      hoursOpen: Math.round((now - created) / 3600000),
    };
  });

  const resellerRows: DelayRow[] = (resellers ?? []).map((r) => {
    const due = r.scheduled_date ? new Date(r.scheduled_date).getTime() : now;
    return {
      id: r.id,
      kind: "Reseller",
      orderNumber: r.reference_no ?? r.reseller_name,
      customer: r.reseller_name,
      status: r.status,
      city: r.city,
      createdAt: r.scheduled_date,
      hoursOpen: Math.round((now - due) / 3600000),
    };
  });

  return [...orderRows, ...resellerRows].sort((a, b) => b.hoursOpen - a.hoursOpen);
}

export interface BranchRow {
  location: string;
  total: number;
  open: number;
  received: number;
}

/** PRT requests grouped by source branch (how much branch support each location provides). */
export async function branchSupportReport(): Promise<BranchRow[]> {
  const { data, error } = await supabase.from("prt_requests").select("from_location, status").limit(2000);
  if (error) throw new Error(error.message);
  const map = new Map<string, BranchRow>();
  for (const r of data ?? []) {
    const loc = r.from_location ?? "—";
    const row = map.get(loc) ?? { location: loc, total: 0, open: 0, received: 0 };
    row.total += 1;
    if (r.status === "received" || r.status === "closed") row.received += 1;
    else if (r.status !== "cancelled") row.open += 1;
    map.set(loc, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export interface CourierRow {
  courier: string;
  shipments: number;
  pushed: number;
  failed: number;
}

/** Tracking pushes grouped by courier. */
export async function courierReport(): Promise<CourierRow[]> {
  const { data, error } = await supabase
    .from("tracking_updates")
    .select("courier, pushed_to_shopify, shopify_error")
    .limit(2000);
  if (error) throw new Error(error.message);
  const map = new Map<string, CourierRow>();
  for (const r of data ?? []) {
    const c = r.courier ?? "—";
    const row = map.get(c) ?? { courier: c, shipments: 0, pushed: 0, failed: 0 };
    row.shipments += 1;
    if (r.pushed_to_shopify) row.pushed += 1;
    if (r.shopify_error) row.failed += 1;
    map.set(c, row);
  }
  return [...map.values()].sort((a, b) => b.shipments - a.shipments);
}
