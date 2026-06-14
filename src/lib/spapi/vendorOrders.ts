import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type VendorPORow = Tables<"vendor_purchase_orders">;

export async function fetchVendorPOs(search?: string): Promise<VendorPORow[]> {
  let q = supabase.from("vendor_purchase_orders").select("*").order("po_date", { ascending: false }).limit(500);
  const s = search?.trim();
  if (s) q = q.or([`po_number.ilike.%${s}%`, `po_state.ilike.%${s}%`].join(","));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function vendorPoLastSync(): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "vendor_po_last_sync").maybeSingle();
  return (data as { value?: string | null } | null)?.value ?? null;
}

export interface PoSyncResult {
  fetched: number;
  upserted: number;
  lastSync: string;
}

export async function syncVendorPOs(): Promise<PoSyncResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/spapi/sync-po", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Partial<PoSyncResult>;
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return { fetched: j.fetched ?? 0, upserted: j.upserted ?? 0, lastSync: j.lastSync ?? "" };
}
