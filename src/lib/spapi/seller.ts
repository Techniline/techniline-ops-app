import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type SellerFinanceRow = Tables<"seller_finance_groups">;
export type SellerOrderRow = Tables<"seller_orders">;
export type SellerReturnRow = Tables<"seller_returns">;

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

export async function fetchSellerReturns(search?: string): Promise<SellerReturnRow[]> {
  let q = supabase.from("seller_returns").select("*").order("return_date", { ascending: false }).limit(1000);
  const s = search?.trim();
  if (s) q = q.or([`order_id.ilike.%${s}%`, `sku.ilike.%${s}%`, `asin.ilike.%${s}%`].join(","));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function sellerLastSync(): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "seller_last_sync").maybeSingle();
  return (data as { value?: string | null } | null)?.value ?? null;
}

export interface SellerSyncResult {
  finance: number;
  orders: number;
  returns: number;
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
  return { finance: j.finance ?? 0, orders: j.orders ?? 0, returns: j.returns ?? 0, warnings: j.warnings ?? [], lastSync: j.lastSync ?? "" };
}
