import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type PerformanceReview = Tables<"performance_reviews">;
export type PerformanceTarget = Tables<"performance_targets">;
export type QualityEntry = Tables<"quality_log">;

export interface StaffMember { id: string; name: string }

/** Month window helpers (Dubai-agnostic; uses date strings). */
export function monthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function bounds(month: string): { start: string; next: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const nm = m === 12 ? 1 : (m ?? 1) + 1;
  const ny = m === 12 ? (y ?? 0) + 1 : y;
  const next = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, next };
}

/** A single appraisal metric: actual value vs (optional) target. */
export interface Metric {
  key: string;
  label: string;
  value: number;
  display: string; // formatted value
  target?: number | null;
  higherIsBetter: boolean;
}

export interface Appraisal {
  userId: string;
  month: string;
  metrics: Metric[];
}

const sum = (rows: Array<Record<string, unknown>>, k: string) =>
  rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

/** Fetch staff who can be appraised (have an assignee footprint). */
export async function fetchStaff(): Promise<StaffMember[]> {
  const { data } = await supabase.from("users").select("id, full_name, email, role");
  return (data ?? []).map((u) => ({ id: u.id, name: u.full_name ?? u.email ?? u.id }));
}

/** Compute one person's metrics for a month, merged with their targets. */
export async function fetchAppraisal(userId: string, month: string): Promise<Appraisal> {
  const { start, next } = bounds(month);
  const [tasksRes, breachRes, dedRes, returnsRes, cartsRes, actionsRes, blockersRes, targetsRes] =
    await Promise.all([
      supabase.from("daily_tasks").select("status").eq("assigned_to", userId).gte("task_date", start).lt("task_date", next),
      supabase.from("breach_log").select("id").eq("user_id", userId).gte("breach_date", start).lt("breach_date", next),
      supabase.from("remittance_deductions").select("approved_amount_aed, status, closed_at").eq("closed_by", userId).gte("closed_at", start).lt("closed_at", next),
      supabase.from("returns").select("id, recovery_amt_aed").eq("logged_by", userId).gte("date_received", start).lt("date_received", next),
      supabase.from("mm_recovered_carts").select("amount").eq("recovered_by", userId).gte("recovered_date", start).lt("recovered_date", next),
      supabase.from("mm_abandoned_actions").select("action_status").eq("actioned_by", userId).gte("actioned_at", start).lt("actioned_at", next),
      supabase.from("blockers").select("id").eq("resolved_by", userId).gte("resolved_at", start).lt("resolved_at", next),
      supabase.from("performance_targets").select("metric_key, target_value").eq("user_id", userId),
    ]);

  const tasks = tasksRes.data ?? [];
  const assigned = tasks.length;
  const completed = tasks.filter((t) => t.status === "submitted").length;
  const compliance = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
  const breaches = (breachRes.data ?? []).length;
  const dedClosed = (dedRes.data ?? []).length;
  const recovery = Math.round(sum(dedRes.data ?? [], "approved_amount_aed"));
  const returnsLogged = (returnsRes.data ?? []).length;
  const cartsRecovered = (cartsRes.data ?? []).length;
  const deals = (actionsRes.data ?? []).filter((a) => a.action_status === "deal_created").length;
  const blockersResolved = (blockersRes.data ?? []).length;

  const tmap = new Map((targetsRes.data ?? []).map((t) => [t.metric_key, t.target_value]));
  const t = (k: string) => (tmap.has(k) ? (tmap.get(k) as number | null) : undefined);

  const aed = (n: number) => `AED ${n.toLocaleString()}`;
  const metrics: Metric[] = [
    { key: "compliance", label: "Checklist compliance", value: compliance, display: `${compliance}%`, target: t("compliance"), higherIsBetter: true },
    { key: "completed", label: "Tasks completed", value: completed, display: `${completed} / ${assigned}`, target: t("completed"), higherIsBetter: true },
    { key: "breaches", label: "Checklist breaches", value: breaches, display: String(breaches), target: t("breaches"), higherIsBetter: false },
    { key: "deductions_closed", label: "Remittance deductions closed", value: dedClosed, display: String(dedClosed), target: t("deductions_closed"), higherIsBetter: true },
    { key: "recovery_aed", label: "Recovery (approved)", value: recovery, display: aed(recovery), target: t("recovery_aed"), higherIsBetter: true },
    { key: "returns_logged", label: "Returns logged", value: returnsLogged, display: String(returnsLogged), target: t("returns_logged"), higherIsBetter: true },
    { key: "carts_recovered", label: "Carts recovered", value: cartsRecovered, display: String(cartsRecovered), target: t("carts_recovered"), higherIsBetter: true },
    { key: "deals_created", label: "Zoho deals created", value: deals, display: String(deals), target: t("deals_created"), higherIsBetter: true },
    { key: "blockers_resolved", label: "Blockers resolved", value: blockersResolved, display: String(blockersResolved), target: t("blockers_resolved"), higherIsBetter: true },
  ];
  return { userId, month, metrics };
}

/** 6-month trend of compliance %, breaches and recovery for one person. */
export interface TrendPoint { month: string; compliance: number; breaches: number; recovery: number }
export async function fetchTrend(userId: string, months = 6): Promise<TrendPoint[]> {
  const now = new Date();
  const out: TrendPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = monthStr(d);
    const a = await fetchAppraisal(userId, m);
    const get = (k: string) => a.metrics.find((x) => x.key === k)?.value ?? 0;
    out.push({ month: m, compliance: get("compliance"), breaches: get("breaches"), recovery: get("recovery_aed") });
  }
  return out;
}

export async function fetchTargets(userId: string): Promise<PerformanceTarget[]> {
  const { data } = await supabase.from("performance_targets").select("*").eq("user_id", userId);
  return data ?? [];
}
export async function saveTarget(userId: string, metricKey: string, value: number | null, by: string): Promise<void> {
  const { error } = await supabase
    .from("performance_targets")
    .upsert({ user_id: userId, metric_key: metricKey, target_value: value, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "user_id,metric_key" });
  if (error) throw new Error(error.message);
}

export async function fetchReview(userId: string, month: string): Promise<PerformanceReview | null> {
  const { data } = await supabase.from("performance_reviews").select("*").eq("user_id", userId).eq("period_month", `${month}-01`).maybeSingle();
  return data ?? null;
}
export async function saveReview(userId: string, month: string, rating: number | null, notes: string, by: string): Promise<void> {
  const { error } = await supabase
    .from("performance_reviews")
    .upsert({ user_id: userId, period_month: `${month}-01`, rating, notes: notes.trim() || null, reviewed_by: by, updated_at: new Date().toISOString() }, { onConflict: "user_id,period_month" });
  if (error) throw new Error(error.message);
}

export async function fetchQuality(userId: string, month: string): Promise<QualityEntry[]> {
  const { start, next } = bounds(month);
  const { data } = await supabase.from("quality_log").select("*").eq("user_id", userId).gte("occurred_on", start).lt("occurred_on", next).order("occurred_on", { ascending: false });
  return data ?? [];
}
export async function addQuality(e: {
  userId: string;
  channel: string;
  severity: string;
  description: string;
  orderRef: string;
  occurredOn: string;
  loggedBy: string;
}): Promise<void> {
  const { error } = await supabase.from("quality_log").insert({
    user_id: e.userId,
    channel: e.channel.trim() || null,
    severity: e.severity,
    description: e.description.trim() || null,
    order_ref: e.orderRef.trim() || null,
    logged_by: e.loggedBy,
    occurred_on: e.occurredOn || new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(error.message);
}

/** Channels an error can be attributed to (for the Quality/Errors logger). */
export const QUALITY_CHANNELS = [
  "Musicmajlis",
  "Amazon Seller",
  "Amazon DF",
  "Amazon Flex",
  "Noon",
  "Cocoblu",
  "Vendor PO",
  "Other",
] as const;
export async function deleteQuality(id: string): Promise<void> {
  await supabase.from("quality_log").delete().eq("id", id);
}
