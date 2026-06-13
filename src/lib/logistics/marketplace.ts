import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert } from "@/lib/types";

export type ReturnRow = Tables<"marketplace_returns">;

export const CHANNELS: { value: string; label: string }[] = [
  { value: "amazon_vendor", label: "Amazon Vendor" },
  { value: "amazon_df", label: "Amazon DF" },
  { value: "amazon_seller_flex", label: "Amazon Seller / Flex" },
  { value: "noon", label: "Noon" },
];

export const RETURN_REASONS: { value: string; label: string }[] = [
  { value: "customer_return", label: "Customer return" },
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "not_delivered", label: "Not delivered" },
  { value: "other", label: "Other" },
];

export const CONDITIONS: { value: string; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "damaged", label: "Damaged" },
  { value: "opened", label: "Opened" },
  { value: "missing_parts", label: "Missing parts" },
];

export const PHYSICAL_STATUS: { value: string; label: string }[] = [
  { value: "expected", label: "Expected" },
  { value: "received", label: "Received" },
  { value: "inspected", label: "Inspected" },
  { value: "restocked", label: "Restocked" },
  { value: "disposed", label: "Disposed" },
  { value: "issue_hold", label: "Issue / Hold" },
];

export const DOC_STATUS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending docs" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "credited", label: "Credited" },
  { value: "rejected", label: "Rejected" },
  { value: "closed", label: "Closed" },
];

export function rLabel(set: { value: string; label: string }[], v: string | null | undefined): string {
  if (!v) return "—";
  return set.find((o) => o.value === v)?.label ?? v;
}

export interface ReturnFilters {
  channel?: string;
  docPending?: boolean;
  search?: string;
}

export async function fetchReturns(f: ReturnFilters = {}): Promise<ReturnRow[]> {
  let q = supabase.from("marketplace_returns").select("*").order("created_at", { ascending: false }).limit(500);
  if (f.channel) q = q.eq("channel", f.channel);
  if (f.docPending) q = q.in("doc_status", ["pending", "in_progress"]);
  const s = f.search?.trim();
  if (s) {
    const like = `%${s}%`;
    q = q.or(
      [`return_ref.ilike.${like}`, `order_ref.ilike.${like}`, `sku.ilike.${like}`, `asin.ilike.${like}`, `product.ilike.${like}`].join(",")
    );
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function uid(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Create or update a return. On create, the row defaults to doc_status 'pending'
 *  (Maricel's queue) and the caller triggers the notify email. Returns the row. */
export async function saveReturn(row: Partial<ReturnRow> & { id?: string }): Promise<ReturnRow> {
  const isNew = !row.id;
  const me = await uid();
  const payload = {
    ...row,
    logged_by: row.logged_by ?? (isNew ? me : undefined),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"marketplace_returns">;
  const { data, error } = await supabase.from("marketplace_returns").upsert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

/** Update the documentation section (Maricel); stamps documented_by. */
export async function saveReturnDocs(id: string, patch: Partial<ReturnRow>): Promise<void> {
  const me = await uid();
  const { error } = await supabase
    .from("marketplace_returns")
    .update({ ...patch, documented_by: me, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteReturn(id: string): Promise<void> {
  const { error } = await supabase.from("marketplace_returns").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Count of returns still needing documentation (Maricel's queue badge). */
export async function docsPendingCount(): Promise<number> {
  const { count } = await supabase
    .from("marketplace_returns")
    .select("*", { count: "exact", head: true })
    .in("doc_status", ["pending", "in_progress"]);
  return count ?? 0;
}

/** Notify Maricel that a return was logged (server emails her). Best-effort. */
export async function notifyReturnLogged(summary: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  await fetch("/api/logistics/notify-return", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  }).catch(() => {});
}
