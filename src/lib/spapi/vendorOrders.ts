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

/** A single line on a Vendor PO, parsed from the synced `raw` payload. */
export interface VendorPOItem {
  seq: string | null;
  sku: string | null;
  asin: string | null;
  title: string | null;
  orderedQty: number | null;
  acceptedQty: number | null;
  unitCost: number | null;
  currency: string | null;
}

/** Parse the accepted/ordered product lines out of a synced PO's raw payload. */
export function parsePOItems(raw: unknown): VendorPOItem[] {
  const items = (raw as { orderDetails?: { items?: unknown[] } } | null)?.orderDetails?.items;
  if (!Array.isArray(items)) return [];
  const num = (v: unknown) => {
    const n = Number((v as { amount?: unknown } | null)?.amount ?? v);
    return Number.isFinite(n) ? n : null;
  };
  return items.map((it) => {
    const i = (it ?? {}) as Record<string, unknown>;
    const ordered = i.orderedQuantity as { amount?: unknown } | undefined;
    // Vendor Central exposes the confirmed/accepted qty under acknowledgement.
    const accepted = (i.acknowledgedQuantity ?? i.acceptedQuantity) as { amount?: unknown } | undefined;
    const netCost = i.netCost as { amount?: unknown; currencyCode?: string } | undefined;
    return {
      seq: i.itemSequenceNumber != null ? String(i.itemSequenceNumber) : null,
      sku: (i.vendorProductIdentifier as string) ?? null,
      asin: (i.amazonProductIdentifier as string) ?? null,
      title: (i.title as string) ?? null,
      orderedQty: ordered ? num(ordered) : null,
      acceptedQty: accepted ? num(accepted) : null,
      unitCost: netCost ? num(netCost) : null,
      currency: netCost?.currencyCode ?? null,
    };
  });
}

/** Editable internal fields maintained on a PO (never overwritten by sync). */
export interface VendorPOPatch {
  booking_date?: string | null;
  booking_ref?: string | null;
  internal_status?: string | null;
  internal_note?: string | null;
  invoice_number?: string | null;
}

export async function updateVendorPO(id: string, patch: VendorPOPatch): Promise<VendorPORow> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/spapi/po-update", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; row?: VendorPORow };
  if (!res.ok || !j.ok || !j.row) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.row;
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
