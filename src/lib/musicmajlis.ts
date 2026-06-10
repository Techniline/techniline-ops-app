import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type MmTarget = Tables<"mm_targets">;
export type MmRecoveredCart = Tables<"mm_recovered_carts">;

// The store operates on Gulf Standard Time (GMT+4). Vercel runs in UTC, so we
// shift "now" into Dubai time for all calendar maths and emit window bounds with
// a +04:00 offset — this makes our month/day windows line up with Shopify's reports.
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
const DUBAI_TZ = "+04:00";

/** "Now" as seen on the wall clock in Dubai (use the getUTC* accessors on it). */
function dubaiNow(): Date {
  return new Date(Date.now() + DUBAI_OFFSET_MS);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Midnight (Dubai) of a given Y/M/D as an ISO string with the +04:00 offset. */
function dubaiMidnightIso(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}T00:00:00${DUBAI_TZ}`;
}

/** Current-month boundaries (Dubai time): month key (1st) + ISO window for Shopify. */
export function monthBounds(): { monthStr: string; fromIso: string; toIso: string } {
  const d = dubaiNow();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  return {
    monthStr: `${y}-${pad(m + 1)}-01`,
    fromIso: dubaiMidnightIso(y, m, 1),
    toIso: dubaiMidnightIso(ny, nm, 1),
  };
}

/**
 * The abandoned-cart review window = the previous working day(s), since carts are
 * actioned the next morning. Returns null on Sunday (non-working day → show nothing).
 * - Tue–Sat: yesterday 00:00 → today 00:00.
 * - Monday:  Saturday 00:00 → Monday 00:00 (covers Sat + Sun in one go).
 */
export function abandonedWindow(): { fromIso: string; toIso: string; label: string } | null {
  const d = dubaiNow();
  const day = d.getUTCDay(); // 0=Sun … 6=Sat (Dubai wall clock)
  if (day === 0) return null; // Sunday — nothing to action
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const date = d.getUTCDate();
  const back = day === 1 ? 2 : 1; // Monday reaches back to Saturday
  // Build the "from" date by subtracting `back` days at UTC, then read its parts.
  const fromDate = new Date(Date.UTC(y, m, date - back));
  const today = new Date(Date.UTC(y, m, date));
  const label = day === 1 ? "Sat–Sun" : "yesterday";
  return {
    fromIso: dubaiMidnightIso(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()),
    toIso: dubaiMidnightIso(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    label,
  };
}

/** Working days (Mon–Sat) remaining this month (Dubai time), including today. */
export function remainingWorkingDays(): number {
  const now = dubaiNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let n = 0;
  for (let day = now.getUTCDate(); day <= lastDay; day += 1) {
    if (new Date(Date.UTC(y, m, day)).getUTCDay() !== 0) n += 1; // skip Sunday
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

export interface AbandonedCart {
  id: string;
  createdAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  total: number | null;
  recoveryUrl: string | null;
  actionStatus: "open" | "actioned" | "deal_created" | "dismissed";
  zohoDealId: string | null;
  zohoDealUrl: string | null;
  note: string | null;
}

export interface AbandonedResult {
  configured: boolean;
  windowLabel: string | null; // null on Sunday
  carts: AbandonedCart[];
  openCount: number;
  error?: string;
}

/** Abandoned carts for the previous-working-day window, merged with Aaron's actions. */
export async function fetchAbandonedCarts(): Promise<AbandonedResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { configured: false, windowLabel: null, carts: [], openCount: 0 };
  const res = await fetch("/api/shopify/abandoned", { headers: { Authorization: `Bearer ${token}` } });
  const j = (await res.json().catch(() => ({}))) as Partial<AbandonedResult> & { ok?: boolean };
  if (!res.ok || !j.ok) {
    return { configured: false, windowLabel: null, carts: [], openCount: 0, error: j.error };
  }
  return {
    configured: !!j.configured,
    windowLabel: j.windowLabel ?? null,
    carts: j.carts ?? [],
    openCount: j.openCount ?? 0,
  };
}

/** Mark an abandoned cart actioned (cleared) / dismissed, or "open" to undo. */
export async function actionAbandonedCart(
  cart: AbandonedCart,
  status: "actioned" | "dismissed" | "open",
  note: string | null
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/mm/action-cart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      checkoutId: cart.id,
      status,
      note,
      customerName: cart.customerName,
      customerEmail: cart.customerEmail,
      total: cart.total,
      recoveryUrl: cart.recoveryUrl,
      createdAt: cart.createdAt,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}

export interface CreateDealResult {
  status: "created" | "duplicate" | "error";
  dealId: string | null;
  dealUrl: string | null;
  message: string;
}

/** Create a Back-to-Back deal in Zoho for an abandoned cart (dedup by email first). */
export async function createDealForCart(cart: AbandonedCart): Promise<CreateDealResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/zoho/create-deal", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      checkoutId: cart.id,
      customerName: cart.customerName,
      customerEmail: cart.customerEmail,
      total: cart.total,
      recoveryUrl: cart.recoveryUrl,
      createdAt: cart.createdAt,
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Partial<CreateDealResult> & { ok?: boolean; error?: string };
  if (!res.ok || !j.status) {
    return { status: "error", dealId: null, dealUrl: null, message: j.error ?? `HTTP ${res.status}` };
  }
  return {
    status: j.status,
    dealId: j.dealId ?? null,
    dealUrl: j.dealUrl ?? null,
    message: j.message ?? "",
  };
}

export interface MonthActionCounts {
  actioned: number; // marked actioned (not turned into a deal)
  deals: number; // turned into a Zoho deal
}

/** Carts actioned / turned into deals this month (Dubai), from our records. */
export async function fetchActionedThisMonth(): Promise<MonthActionCounts> {
  const { monthStr } = monthBounds();
  const { data, error } = await supabase
    .from("mm_abandoned_actions")
    .select("action_status, actioned_at")
    .gte("actioned_at", `${monthStr}T00:00:00+04:00`);
  if (error) return { actioned: 0, deals: 0 };
  let actioned = 0;
  let deals = 0;
  for (const r of data ?? []) {
    if (r.action_status === "deal_created") deals += 1;
    else if (r.action_status === "actioned") actioned += 1;
  }
  return { actioned, deals };
}

export interface MmMetrics {
  configured: boolean;
  netSales: number | null;
  abandonedCarts: number | null;
  daily: Record<string, number>; // YYYY-MM-DD → net sales that day (Dubai)
  error?: string;
}

/** Shopify net sales + abandoned carts (+ daily series) for this month (server route). */
export async function fetchMmMetrics(): Promise<MmMetrics> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { configured: false, netSales: null, abandonedCarts: null, daily: {} };
  const { fromIso, toIso } = monthBounds();
  const res = await fetch(`/api/shopify/mm-metrics?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean; configured?: boolean; netSales?: number; abandonedCarts?: number; daily?: Record<string, number>; error?: string;
  };
  if (!res.ok || !j.ok) return { configured: false, netSales: null, abandonedCarts: null, daily: {}, error: j.error };
  return {
    configured: !!j.configured,
    netSales: j.netSales ?? null,
    abandonedCarts: j.abandonedCarts ?? null,
    daily: j.daily ?? {},
  };
}

/** Build cumulative actual vs ideal-pace series for the month (for the chart). */
export interface PacePoint {
  day: number; // day-of-month
  date: string; // YYYY-MM-DD
  actual: number | null; // cumulative net sales up to & incl. this day (null = future)
  pace: number; // cumulative ideal target by this day
  isToday: boolean;
}

export function buildPaceSeries(target: number, daily: Record<string, number>): PacePoint[] {
  const now = dubaiNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const todayDom = now.getUTCDate();
  const lastDom = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  // Total working days (Mon–Sat) in the month → ideal daily pace.
  let totalWorkdays = 0;
  for (let d = 1; d <= lastDom; d += 1) {
    if (new Date(Date.UTC(y, m, d)).getUTCDay() !== 0) totalWorkdays += 1;
  }
  const perWorkday = totalWorkdays > 0 ? target / totalWorkdays : 0;

  const pts: PacePoint[] = [];
  let cumActual = 0;
  let cumPace = 0;
  for (let d = 1; d <= lastDom; d += 1) {
    const date = `${y}-${pad(m + 1)}-${pad(d)}`;
    const isWorkday = new Date(Date.UTC(y, m, d)).getUTCDay() !== 0;
    if (isWorkday) cumPace += perWorkday;
    if (d <= todayDom) cumActual += daily[date] ?? 0;
    pts.push({
      day: d,
      date,
      actual: d <= todayDom ? Number(cumActual.toFixed(2)) : null,
      pace: Number(cumPace.toFixed(2)),
      isToday: d === todayDom,
    });
  }
  return pts;
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
