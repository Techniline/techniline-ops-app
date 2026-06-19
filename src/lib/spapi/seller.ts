import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type SellerFinanceRow = Tables<"seller_finance_groups">;
export type SellerOrderRow = Tables<"seller_orders">;

/** Fulfillment label in the team's vocabulary: AFN (FBA) shown as "Flex"; MFN
 *  splits into Easy Ship (has an EasyShipShipmentStatus marker) vs Self Ship. */
export function fulfillmentLabel(o: SellerOrderRow): string {
  const ch = (o.fulfillment_channel ?? "").toUpperCase();
  if (ch === "AFN") return "Flex";
  if (ch === "MFN") {
    const raw = (o.raw ?? null) as { EasyShipShipmentStatus?: string } | null;
    return raw?.EasyShipShipmentStatus ? "Easy Ship" : "Self Ship";
  }
  return o.fulfillment_channel ?? "—";
}

/** Any order with unshipped items that isn't already shipped or cancelled. */
export function needsFulfillment(o: SellerOrderRow): boolean {
  const st = (o.order_status ?? "").toLowerCase();
  if (st === "shipped" || st.includes("cancel")) return false;
  return (o.items_unshipped ?? 0) > 0;
}

export async function fetchSellerOrders(search?: string): Promise<SellerOrderRow[]> {
  let q = supabase.from("seller_orders").select("*").order("purchase_date", { ascending: false }).limit(1000);
  const s = search?.trim();
  if (s) q = q.or([`amazon_order_id.ilike.%${s}%`, `order_status.ilike.%${s}%`, `fulfillment_channel.ilike.%${s}%`].join(","));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchSellerFinance(search?: string): Promise<SellerFinanceRow[]> {
  let q = supabase.from("seller_finance_groups").select("*").order("start_time", { ascending: false }).limit(500);
  const s = search?.trim();
  if (s) q = q.or([`group_id.ilike.%${s}%`, `status.ilike.%${s}%`].join(","));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type SellerOrderItemRow = Tables<"seller_order_items">;

/** Invoice line items for one order, synced from Amazon's Orders API. */
export async function fetchSellerOrderItems(amazonOrderId: string): Promise<SellerOrderItemRow[]> {
  const { data, error } = await supabase
    .from("seller_order_items")
    .select("*")
    .eq("amazon_order_id", amazonOrderId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type SellerOrderDocRow = Tables<"seller_order_docs">;

/** Return documentation keyed by amazon_order_id. */
export async function fetchSellerOrderDocs(): Promise<Map<string, SellerOrderDocRow>> {
  const map = new Map<string, SellerOrderDocRow>();
  const { data, error } = await supabase.from("seller_order_docs").select("*");
  if (error) return map;
  for (const d of data ?? []) map.set(d.amazon_order_id, d);
  return map;
}

export interface SellerOrderDocPatch {
  invoice_number?: string | null;
  prt_number?: string | null;
  srt_number?: string | null;
  return_note?: string | null;
  doc_status?: string | null;
  delivery_status?: string | null;
  delivery_date?: string | null;
  amazon_return_date?: string | null;
  tracking_number?: string | null;
  delivery_charge?: number | null;
  delivery_address?: string | null;
}

export interface AmazonDeliveryImportSummary {
  rowsBySheet: Record<string, number>;
  distinctOrders: number;
  ordersInSystem: number;
  matched: number;
  willWrite: number;
  unmatchedBySheet: Record<string, number>;
  sampleUnmatched: string[];
  sampleWrite: { amazon_order_id: string }[];
}

export interface AmazonInvoiceImportSummary {
  ledgerRows: number;
  distinctOrders: number;
  ordersInSystem: number;
  matched: number;
  willFill: number;
  alreadyHad: number;
  unmatched: number;
  sampleUnmatched: string[];
  sampleFill: { amazon_order_id: string; invoice_number: string }[];
}

/** Upload the SIS ledger; preview (apply=false) or fill (apply=true) Amazon order
 *  invoice numbers into seller_order_docs (matched by order id). */
export async function importAmazonInvoices(
  file: File,
  apply: boolean
): Promise<{ dryRun: boolean; filled?: number; summary: AmazonInvoiceImportSummary }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/logistics/import-amazon-invoices?apply=${apply ? "1" : "0"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.ok !== true) throw new Error((j.error as string) ?? `HTTP ${res.status}`);
  return { dryRun: !!j.dryRun, filled: j.filled as number | undefined, summary: j.summary as AmazonInvoiceImportSummary };
}

/** Upload the Amazon Seller Delivery List workbook; preview (apply=false) or
 *  backfill (apply=true) delivery/return data into seller_order_docs. */
export async function importAmazonDelivery(
  file: File,
  apply: boolean
): Promise<{ dryRun: boolean; written?: number; summary: AmazonDeliveryImportSummary }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/logistics/import-amazon-delivery?apply=${apply ? "1" : "0"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.ok !== true) throw new Error((j.error as string) ?? `HTTP ${res.status}`);
  return { dryRun: !!j.dryRun, written: j.written as number | undefined, summary: j.summary as AmazonDeliveryImportSummary };
}

export type SellerOrderDocLogRow = Tables<"seller_order_doc_log">;

export async function updateSellerOrderDoc(
  amazonOrderId: string,
  patch: SellerOrderDocPatch,
  comment?: string
): Promise<SellerOrderDocRow> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/spapi/seller-order-doc", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amazon_order_id: amazonOrderId, ...patch, comment }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; row?: SellerOrderDocRow };
  if (!res.ok || !j.ok || !j.row) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.row;
}

/** Edit history for one order's return docs, newest first. */
export async function fetchSellerOrderDocLog(amazonOrderId: string): Promise<SellerOrderDocLogRow[]> {
  const { data, error } = await supabase
    .from("seller_order_doc_log")
    .select("*")
    .eq("amazon_order_id", amazonOrderId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return data ?? [];
}

export async function sellerLastSync(): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "seller_last_sync").maybeSingle();
  return (data as { value?: string | null } | null)?.value ?? null;
}

export interface SellerSyncResult {
  finance: number;
  orders: number;
  items: number;
  warnings: string[];
  lastSync: string;
}

export async function syncSeller(): Promise<SellerSyncResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/spapi/seller-sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Partial<SellerSyncResult>;
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return { finance: j.finance ?? 0, orders: j.orders ?? 0, items: j.items ?? 0, warnings: j.warnings ?? [], lastSync: j.lastSync ?? "" };
}
