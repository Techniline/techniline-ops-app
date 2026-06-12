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

/** Escape PostgREST `or()` reserved chars in a user term (commas, parens, *). */
function sanitize(term: string): string {
  return term.replace(/[(),*\\]/g, " ").trim();
}

/** Apply the structured (non-text) filters to an orders query. */
function applyFilters<T>(q: T, filters: OrderFilters): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let r: any = q;
  if (filters.logisticsStatus) r = r.eq("logistics_status", filters.logisticsStatus);
  if (filters.fulfillmentStatus) r = r.eq("fulfillment_status", filters.fulfillmentStatus);
  if (filters.city) r = r.eq("shipping_city", filters.city);
  if (filters.shippingMethod) r = r.eq("shipping_method", filters.shippingMethod);
  if (filters.from) r = r.gte("shopify_created_at", filters.from);
  if (filters.to) r = r.lte("shopify_created_at", filters.to);
  return r as T;
}

/**
 * Premium search across header fields (order #, name, phone, email) AND line
 * items (SKU, product title, brand), merged into one result set. Phone matching
 * is format-insensitive: a typed number is reduced to digits and also matched on
 * its last 9 digits, so "+971 50 123 4567", "0501234567" and "501234567" all hit.
 */
export async function fetchOrders(filters: OrderFilters = {}): Promise<ShopifyOrderRow[]> {
  const s = sanitize(filters.search ?? "");

  // No search term → straight filtered list.
  if (!s) {
    const { data, error } = await applyFilters(
      supabase.from("shopify_orders").select("*"),
      filters
    )
      .order("shopify_created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  const like = `%${s}%`;
  const digits = s.replace(/\D/g, "");
  const orParts = [
    `order_number.ilike.${like}`,
    `customer_name.ilike.${like}`,
    `email.ilike.${like}`,
    `shipping_phone.ilike.${like}`,
  ];
  if (digits) {
    orParts.push(`shipping_phone.ilike.%${digits}%`);
    if (digits.length >= 9) orParts.push(`shipping_phone.ilike.%${digits.slice(-9)}%`);
  }

  // 1) Header matches.
  const headerQ = applyFilters(supabase.from("shopify_orders").select("*"), filters)
    .or(orParts.join(","))
    .order("shopify_created_at", { ascending: false })
    .limit(500);

  // 2) Line-item matches (SKU / title / brand) → order ids.
  const itemQ = supabase
    .from("shopify_order_items")
    .select("order_id")
    .or([`sku.ilike.${like}`, `title.ilike.${like}`, `brand.ilike.${like}`].join(","))
    .limit(1000);

  const [{ data: headerRows, error: hErr }, { data: itemRows }] = await Promise.all([headerQ, itemQ]);
  if (hErr) throw new Error(hErr.message);

  const byId = new Map<string, ShopifyOrderRow>();
  for (const r of headerRows ?? []) byId.set(r.id, r);

  const itemIds = [...new Set((itemRows ?? []).map((i) => i.order_id))].filter((id) => !byId.has(id));
  if (itemIds.length) {
    const { data: itemOrders } = await applyFilters(
      supabase.from("shopify_orders").select("*").in("id", itemIds),
      filters
    ).limit(500);
    for (const r of itemOrders ?? []) byId.set(r.id, r);
  }

  return [...byId.values()].sort((a, b) => {
    const ta = a.shopify_created_at ? Date.parse(a.shopify_created_at) : 0;
    const tb = b.shopify_created_at ? Date.parse(b.shopify_created_at) : 0;
    return tb - ta;
  });
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

export interface InvoiceInput {
  orderId: string;
  tleInvoiceNumber: string;
  invoiceValue: number | null;
  invoicedSkus: string;
  remarks: string;
}

export interface InvoiceResult {
  /** true if the record was saved; false means remarks are required first. */
  completed: boolean;
  valueMismatch: boolean;
  skuMismatch: boolean;
  missingSkus: string[];
  extraSkus: string[];
  message?: string;
}

/**
 * Save + verify the TLE invoice. If the value or SKUs don't match and no remarks
 * were given, the server returns 400 with the mismatch detail — we surface that
 * as { completed:false } so the UI can show the mismatch and require remarks,
 * rather than throwing.
 */
export async function saveInvoice(input: InvoiceInput): Promise<InvoiceResult> {
  const res = await fetch("/api/logistics/order", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_invoice", ...input }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const detail = {
    valueMismatch: !!j.valueMismatch,
    skuMismatch: !!j.skuMismatch,
    missingSkus: (j.missingSkus as string[]) ?? [],
    extraSkus: (j.extraSkus as string[]) ?? [],
  };
  if (res.ok && j.ok === true) return { completed: true, ...detail };
  // Mismatch needing remarks is a soft failure, not a hard error.
  if (res.status === 400 && (detail.valueMismatch || detail.skuMismatch)) {
    return { completed: false, ...detail, message: (j.error as string) ?? "Mismatch detected." };
  }
  throw new Error((j.error as string) ?? `HTTP ${res.status}`);
}

export async function closeCancellation(orderId: string, srtNumber: string, prtNumber: string): Promise<void> {
  await post("/api/logistics/order", { action: "close_cancellation", orderId, srtNumber, prtNumber });
}

export interface InvoiceDraft {
  invoiceNumber: string | null;
  invoiceValue: number | null;
  skus: string[];
  engine: "ai" | "basic";
}

/** Upload a TLE invoice PDF and auto-extract number / value / SKUs (no DB write). */
export async function parseInvoicePdf(file: File): Promise<InvoiceDraft> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/logistics/parse-invoice", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}` },
    body: form,
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; draft?: InvoiceDraft; error?: string };
  if (!res.ok || !j.ok || !j.draft) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.draft;
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

// ── Per-user saved table views (server-side, follows the user) ───────────────

export async function loadUserView<T = unknown>(key: string): Promise<T | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("user_prefs")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", key)
    .maybeSingle();
  return ((data as { value?: T } | null)?.value ?? null) as T | null;
}

export async function saveUserView(key: string, value: unknown): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("user_prefs")
    .upsert({ user_id: user.id, key, value: value as never, updated_at: new Date().toISOString() });
}

export interface LedgerImportSummary {
  ledgerRows: number;
  ordersInSystem: number;
  willFill: number;
  alreadyHadInvoice: number;
  unmatchedLedger: number;
  valueMismatches: number;
  sampleUnmatched: string[];
  sampleFill: { snum: string; invoiceNo: string | null; netAmount: number | null; valueMatches: boolean }[];
}

/** Upload the sales ledger and either preview (apply=false) or backfill (apply=true). */
export async function importLedger(
  file: File,
  apply: boolean
): Promise<{ dryRun: boolean; filled?: number; summary: LedgerImportSummary }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/logistics/import-ledger?apply=${apply ? "1" : "0"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}` },
    body: form,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.ok !== true) throw new Error((j.error as string) ?? `HTTP ${res.status}`);
  return {
    dryRun: !!j.dryRun,
    filled: j.filled as number | undefined,
    summary: j.summary as LedgerImportSummary,
  };
}

export async function lastSyncTime(): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "logistics_shopify_last_sync")
    .maybeSingle();
  return (data as { value?: string | null } | null)?.value ?? null;
}
