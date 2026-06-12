import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert } from "@/lib/types";

export type ResellerRow = Tables<"reseller_deliveries">;
export type CargoRow = Tables<"cargo_deliveries">;
export type PrtRow = Tables<"prt_requests">;
export type ActivityRow = Tables<"logistics_activity_logs">;
export type ApiErrorRow = Tables<"logistics_api_error_logs">;

async function currentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── Reseller deliveries ──────────────────────────────────────────────────────

export async function fetchResellers(): Promise<ResellerRow[]> {
  const { data, error } = await supabase
    .from("reseller_deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveReseller(row: Partial<ResellerRow> & { id?: string }): Promise<void> {
  const payload: TablesInsert<"reseller_deliveries"> = {
    ...row,
    created_by: row.id ? undefined : await currentUserId(),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"reseller_deliveries">;
  const { error } = await supabase.from("reseller_deliveries").upsert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteReseller(id: string): Promise<void> {
  const { error } = await supabase.from("reseller_deliveries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Cargo deliveries ─────────────────────────────────────────────────────────

export async function fetchCargo(): Promise<CargoRow[]> {
  const { data, error } = await supabase
    .from("cargo_deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveCargo(row: Partial<CargoRow> & { id?: string }): Promise<void> {
  const payload: TablesInsert<"cargo_deliveries"> = {
    ...row,
    created_by: row.id ? undefined : await currentUserId(),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"cargo_deliveries">;
  const { error } = await supabase.from("cargo_deliveries").upsert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteCargo(id: string): Promise<void> {
  const { error } = await supabase.from("cargo_deliveries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── PRT requests ─────────────────────────────────────────────────────────────

export async function fetchPrts(): Promise<PrtRow[]> {
  const { data, error } = await supabase
    .from("prt_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function savePrt(row: Partial<PrtRow> & { id?: string }): Promise<PrtRow> {
  const payload: TablesInsert<"prt_requests"> = {
    ...row,
    requested_by: row.requested_by ?? (row.id ? undefined : await currentUserId()),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"prt_requests">;
  const { data, error } = await supabase.from("prt_requests").upsert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function setPrtStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from("prt_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Build the PRT request email subject + body (used for send or copy). */
export function buildPrtEmail(p: PrtRow): { subject: string; body: string } {
  const subject = `PRT Request – ${p.sku ?? "—"} – Order ${p.order_number ?? "—"}`;
  const lines = [
    `Please arrange the following product transfer:`,
    ``,
    `Order Number : ${p.order_number ?? "—"}`,
    `Customer     : ${p.customer_name ?? "—"}`,
    `SKU          : ${p.sku ?? "—"}`,
    `Product      : ${p.title ?? "—"}`,
    `Brand        : ${p.brand ?? "—"}`,
    `Quantity     : ${p.qty ?? 1}`,
    `From         : ${p.from_location ?? "—"}`,
    `To           : ${p.to_location ?? "—"}`,
    `Required by  : ${p.required_date ?? "—"}`,
    `Urgency      : ${p.urgency ?? "normal"}`,
    ``,
    p.notes ? `Notes: ${p.notes}` : ``,
    ``,
    `Thank you,`,
    `Techniline Logistics`,
  ];
  return { subject, body: lines.filter((l) => l !== undefined).join("\n") };
}

/** Send the PRT email via the server (Graph). Returns ok or throws. */
export async function sendPrtEmail(to: string, subject: string, body: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/logistics/prt-email", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, body }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}

// ── Activity log + API errors ────────────────────────────────────────────────

export async function fetchActivity(limit = 200): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from("logistics_activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchApiErrors(limit = 100): Promise<ApiErrorRow[]> {
  const { data, error } = await supabase
    .from("logistics_api_error_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
