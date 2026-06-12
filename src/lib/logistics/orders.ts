import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type ShopifyOrderRow = Tables<"shopify_orders">;
export type ShopifyOrderItemRow = Tables<"shopify_order_items">;
export type TrackingUpdateRow = Tables<"tracking_updates">;

export interface OrderFilters {
  search?: string;
  fulfillmentStatus?: string;
  logisticsStatus?: string;
  city?: string;
  shippingMethod?: string;
  from?: string; // ISO date
  to?: string; // ISO date
}

async function token(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const t = session?.access_token;
  if (!t) throw new Error("You must be signed in.");
  return t;
}

/** List orders with search + filters (newest first). */
export async function fetchOrders(filters: OrderFilters = {}): Promise<ShopifyOrderRow[]> {
  let q = supabase.from("shopify_orders").select("*").order("shopify_created_at", { ascending: false }).limit(500);

  if (filters.logisticsStatus) q = q.eq("logistics_status", filters.logisticsStatus);
  if (filters.fulfillmentStatus) q = q.eq("fulfillment_status", filters.fulfillmentStatus);
  if (filters.city) q = q.eq("shipping_city", filters.city);
  if (filters.shippingMethod) q = q.eq("shipping_method", filters.shippingMethod);
  if (filters.from) q = q.gte("shopify_created_at", filters.from);
  if (filters.to) q = q.lte("shopify_created_at", filters.to);

  const s = filters.search?.trim();
  if (s) {
    const like = `%${s}%`;
    q = q.or(
      [
        `order_number.ilike.${like}`,
        `customer_name.ilike.${like}`,
        `shipping_phone.ilike.${like}`,
        `email.ilike.${like}`,
      ].join(",")
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = data ?? [];

  // SKU search needs a join on items — filter client-side if nothing matched the
  // header fields but the term could be a SKU.
  if (s && rows.length === 0) {
    const { data: items } = await supabase
      .from("shopify_order_items")
      .select("order_id")
      .ilike("sku", `%${s}%`)
      .limit(500);
    const ids = [...new Set((items ?? []).map((i) => i.order_id))];
    if (ids.length) {
      const { data: bySku } = await supabase
        .from("shopify_orders")
        .select("*")
        .in("id", ids)
        .order("shopify_created_at", { ascending: false });
      rows = bySku ?? [];
    }
  }
  return rows;
}

export interface OrderDetail {
  order: ShopifyOrderRow;
  items: ShopifyOrderItemRow[];
  tracking: TrackingUpdateRow[];
}

export async function fetchOrderDetail(id: string): Promise<OrderDetail | null> {
  const { data: order, error } = await supabase.from("shopify_orders").select("*").eq("id", id).maybeSingle();
  if (error || !order) return null;
  const [{ data: items }, { data: tracking }] = await Promise.all([
    supabase.from("shopify_order_items").select("*").eq("order_id", id).order("created_at", { ascending: true }),
    supabase.from("tracking_updates").select("*").eq("order_id", id).order("created_at", { ascending: false }),
  ]);
  return { order, items: items ?? [], tracking: tracking ?? [] };
}

/** Distinct values for the filter dropdowns. */
export async function fetchOrderFacets(): Promise<{ cities: string[]; methods: string[] }> {
  const { data } = await supabase.from("shopify_orders").select("shipping_city, shipping_method").limit(1000);
  const cities = new Set<string>();
  const methods = new Set<string>();
  for (const r of data ?? []) {
    if (r.shipping_city) cities.add(r.shipping_city);
    if (r.shipping_method) methods.add(r.shipping_method);
  }
  return { cities: [...cities].sort(), methods: [...methods].sort() };
}

// ── Mutations (server routes) ───────────────────────────────────────────────

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.ok !== true) throw new Error((j.error as string) ?? `HTTP ${res.status}`);
  return j;
}

export interface SyncResult {
  fetched: number;
  ordersUpserted: number;
  itemsUpserted: number;
  errors: number;
  lastSync: string;
}

export async function syncOrders(): Promise<SyncResult> {
  const j = await post("/api/logistics/sync", {});
  return j as unknown as SyncResult;
}

export async function setOrderStatus(orderId: string, status: string, note?: string): Promise<void> {
  await post("/api/logistics/order", { action: "set_status", orderId, status, note });
}

export async function updateItem(
  itemId: string,
  patch: { picked?: boolean; packed?: boolean; picking_status?: string; source_location?: string }
): Promise<void> {
  await post("/api/logistics/order", { action: "update_item", itemId, ...patch });
}

export interface FulfillInput {
  orderId: string;
  courier: string | null;
  trackingNumber: string;
  trackingUrl: string | null;
  dispatchDate: string | null;
  deliveryNotes: string | null;
  notify: boolean;
}

export async function fulfillOrder(input: FulfillInput): Promise<void> {
  await post("/api/logistics/fulfill", input);
}

export async function lastSyncTime(): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "logistics_shopify_last_sync")
    .maybeSingle();
  return (data as { value?: string | null } | null)?.value ?? null;
}
