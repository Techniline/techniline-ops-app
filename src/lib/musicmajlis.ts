import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type MmTarget = Tables<"mm_targets">;
export type MmRecoveredCart = Tables<"mm_recovered_carts">;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Current-month boundaries: month key (1st) + ISO window for Shopify. */
export function monthBounds(): { monthStr: string; fromIso: string; toIso: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { monthStr: ymd(first), fromIso: first.toISOString(), toIso: nextFirst.toISOString() };
}

/** Working days (Mon–Sat) remaining this month, including today. */
export function remainingWorkingDays(): number {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let n = 0;
  while (d <= end) {
    if (d.getDay() !== 0) n += 1; // skip Sunday
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** This month's MM sales target (null if not set). */
export async function fetchMmTarget(): Promise<MmTarget | null> {
  const { monthStr } = monthBounds();
  const { data, error } = await supabase
    .from("mm_targets")
    .select("*")
    .eq("month", monthStr)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** Set/replace this month's target (manager-only via RLS). */
export async function setMmTarget(amount: number, createdBy: string): Promise<void> {
  const { monthStr } = monthBounds();
  const { error } = await supabase
    .from("mm_targets")
    .upsert({ month: monthStr, target_amount: amount, created_by: createdBy }, { onConflict: "month" });
  if (error) throw new Error(error.message);
}

/** Recovered carts logged this month. */
export async function fetchRecoveredThisMonth(): Promise<MmRecoveredCart[]> {
  const { monthStr } = monthBounds();
  const { data, error } = await supabase
    .from("mm_recovered_carts")
    .select("*")
    .gte("recovered_date", monthStr)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Log a recovered cart via the Shopify-validated server route. */
export async function logRecoveredCart(orderRef: string, amount: number | null, note: string | null): Promise<MmRecoveredCart> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/shopify/recover-cart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ orderRef, amount, note }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; log?: MmRecoveredCart; error?: string };
  if (!res.ok || !j.ok || !j.log) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.log;
}

export interface MmMetrics {
  configured: boolean;
  netSales: number | null;
  abandonedCarts: number | null;
  error?: string;
}

/** Shopify net sales + abandoned carts for this month (server route). */
export async function fetchMmMetrics(): Promise<MmMetrics> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { configured: false, netSales: null, abandonedCarts: null };
  const { fromIso, toIso } = monthBounds();
  const res = await fetch(`/api/shopify/mm-metrics?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean; configured?: boolean; netSales?: number; abandonedCarts?: number; error?: string;
  };
  if (!res.ok || !j.ok) return { configured: false, netSales: null, abandonedCarts: null, error: j.error };
  return {
    configured: !!j.configured,
    netSales: j.netSales ?? null,
    abandonedCarts: j.abandonedCarts ?? null,
  };
}

export interface MmKpis {
  target: number;
  achieved: number;
  pct: number;
  todayTarget: number;
  recoveredCount: number;
  recoveredValue: number;
}

/** Compute the KPI figures shown on the dashboard band. */
export function computeMmKpis(target: number, achieved: number, recovered: MmRecoveredCart[]): MmKpis {
  const rwd = remainingWorkingDays();
  const remaining = Math.max(0, target - achieved);
  return {
    target,
    achieved,
    pct: target > 0 ? (achieved / target) * 100 : 0,
    todayTarget: target > 0 ? remaining / Math.max(1, rwd) : 0,
    recoveredCount: recovered.length,
    recoveredValue: recovered.reduce((s, r) => s + (r.amount ?? 0), 0),
  };
}
