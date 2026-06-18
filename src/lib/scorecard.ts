import { formatAED } from "@/lib/format";
import { fetchDeductions, summarizeRecovery } from "@/lib/remittanceDeductions";
import { supabase } from "@/lib/supabaseClient";
import { fetchWazzupStats } from "@/lib/wazzup";

/** One scorecard KPI, with everything the UI needs to render + explain it. */
export interface Kpi {
  key: string;
  label: string;
  icon: string;
  display: string; // formatted headline value
  sub?: string; // supporting context line
  target?: string; // e.g. "≥ 90%"
  status: "good" | "warn" | "bad" | "none";
  progress?: number | null; // 0–100 for the bar (null = no bar)
  how: string; // plain-English calculation
  source: string; // where the data comes from
  type: "leading" | "lagging";
}

export interface Scorecard {
  aaron: Kpi[];
  maricel: Kpi[];
  period: string;
}

const DAY = 86_400_000;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const iso = (ms: number) => new Date(ms).toISOString();

function statusFor(value: number | null, target: number, higherIsBetter: boolean, warnBand = 0.1): Kpi["status"] {
  if (value == null) return "none";
  if (higherIsBetter) {
    if (value >= target) return "good";
    if (value >= target * (1 - warnBand)) return "warn";
    return "bad";
  }
  if (value <= target) return "good";
  if (value <= target * (1 + warnBand)) return "warn";
  return "bad";
}

/** Compute the full KPI scorecard for Aaron + Maricel from live data. Fail-soft. */
export async function fetchScorecard(): Promise<Scorecard> {
  const now = Date.now();
  const since30 = iso(now - 30 * DAY);
  const monthStart = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
  const monthKey = monthStart.toISOString().slice(0, 7);

  // ── shared fetches ─────────────────────────────────────────────────────────
  const [wz, ordersRes, mmSalesRes, mmTargetRes, abandonedRes, recoveredRes, remitRes, returnsRes, deductions] =
    await Promise.all([
      fetchWazzupStats().catch(() => null),
      supabase.from("shopify_orders").select("logistics_status, fulfillment_status").gte("shopify_created_at", since30),
      supabase.from("shopify_orders").select("order_value, logistics_status").gte("shopify_created_at", monthStart.toISOString()),
      supabase.from("mm_targets").select("target_amount").eq("month", monthKey).maybeSingle(),
      supabase.from("mm_abandoned_actions").select("id").gte("created_at", since30),
      supabase.from("mm_recovered_carts").select("amount").gte("recovered_date", since30.slice(0, 10)),
      supabase.from("remittances").select("reconciled, created_at"),
      supabase.from("marketplace_returns").select("created_at, updated_at, doc_status").gte("created_at", iso(now - 90 * DAY)),
      fetchDeductions({ includeClosed: true }).catch(() => []),
    ]);

  // ── AARON ────────────────────────────────────────────────────────────────
  // 1. Chat reply within 15 min (lagging)
  const chatPct = wz?.repliedPct ?? null;
  const aaron: Kpi[] = [];
  aaron.push({
    key: "chat15", label: "Chat reply within 15 min", icon: "💬", type: "lagging",
    display: chatPct == null ? "—" : `${chatPct}%`,
    sub: wz?.repliedTotal ? `of ${wz.repliedTotal} replies (7d)` : "no data yet",
    target: "≥ 90%", status: statusFor(chatPct, 90, true), progress: chatPct,
    how: "Inbound WhatsApp messages answered in under 15 minutes ÷ all answered messages, over the last 7 days.",
    source: "Wazzup message stream (response time per chat).",
  });

  // 2. Same-day order action rate (leading) + 3. Fulfillment rate (lagging)
  const orders = ordersRes.data ?? [];
  const live = orders.filter((o) => o.logistics_status !== "cancelled");
  const actioned = live.filter((o) => o.logistics_status !== "new_order").length;
  const fulfilled = live.filter((o) => o.fulfillment_status === "fulfilled").length;
  const actionRate = pct(actioned, live.length);
  const fulfilRate = pct(fulfilled, live.length);
  aaron.push({
    key: "action", label: "Order action rate", icon: "⚡", type: "leading",
    display: actionRate == null ? "—" : `${actionRate}%`, sub: `${actioned} of ${live.length} orders (30d)`,
    target: "≥ 90%", status: statusFor(actionRate, 90, true), progress: actionRate,
    how: "Orders moved past “New Order” (picked / dispatched / advanced) ÷ all non-cancelled orders created in the last 30 days. A leading sign that nothing is sitting untouched.",
    source: "shopify_orders.logistics_status.",
  });
  aaron.push({
    key: "fulfil", label: "Fulfillment rate", icon: "📦", type: "lagging",
    display: fulfilRate == null ? "—" : `${fulfilRate}%`, sub: `${fulfilled} of ${live.length} orders (30d)`,
    target: "≥ 95%", status: statusFor(fulfilRate, 95, true), progress: fulfilRate,
    how: "Non-cancelled orders marked fulfilled ÷ all non-cancelled orders created in the last 30 days.",
    source: "shopify_orders.fulfillment_status (derived from line-item fulfillment).",
  });

  // 4. Abandoned-cart recovery (lagging)
  const abandoned = (abandonedRes.data ?? []).length;
  const recovered = recoveredRes.data ?? [];
  const recoveredCount = recovered.length;
  const recoveredAed = recovered.reduce((s, r) => s + (r.amount ?? 0), 0);
  const recoveryRate = pct(recoveredCount, abandoned);
  aaron.push({
    key: "cart", label: "Abandoned-cart recovery", icon: "🛒", type: "lagging",
    display: recoveryRate == null ? `${recoveredCount} carts` : `${recoveryRate}%`,
    sub: `${recoveredCount} recovered · ${formatAED(recoveredAed)} (30d)`,
    target: "≥ 20%", status: statusFor(recoveryRate, 20, true), progress: recoveryRate,
    how: "Abandoned checkouts recovered (converted to an order) ÷ abandoned checkouts worked, last 30 days. Value = AED of recovered carts.",
    source: "mm_recovered_carts vs mm_abandoned_actions.",
  });

  // 5. MM sales vs monthly target (lagging)
  const mmSales = (mmSalesRes.data ?? []).filter((o) => o.logistics_status !== "cancelled").reduce((s, o) => s + (o.order_value ?? 0), 0);
  const mmTarget = (mmTargetRes.data as { target_amount?: number } | null)?.target_amount ?? null;
  const mmPct = mmTarget && mmTarget > 0 ? Math.round((mmSales / mmTarget) * 100) : null;
  aaron.push({
    key: "mmsales", label: "MusicMajlis sales (month)", icon: "💰", type: "lagging",
    display: formatAED(mmSales),
    sub: mmTarget ? `${mmPct}% of ${formatAED(mmTarget)} target` : "no target set this month",
    target: mmTarget ? "100% of target" : undefined, status: mmPct == null ? "none" : statusFor(mmPct, 100, true), progress: mmPct == null ? null : Math.min(100, mmPct),
    how: "Sum of order value for all non-cancelled MusicMajlis orders created this calendar month, compared to the month's sales target.",
    source: "shopify_orders.order_value + mm_targets.",
  });

  // ── MARICEL ──────────────────────────────────────────────────────────────
  const maricel: Kpi[] = [];
  // 1. Reconciliation within 7-day SLA (leading/process)
  const remits = remitRes.data ?? [];
  const olderThan7 = remits.filter((r) => r.created_at && now - new Date(r.created_at).getTime() > 7 * DAY);
  const reconciledOld = olderThan7.filter((r) => r.reconciled === true).length;
  const reconPct = pct(reconciledOld, olderThan7.length);
  maricel.push({
    key: "recon", label: "Reconciliation 7-day SLA", icon: "✅", type: "leading",
    display: reconPct == null ? "—" : `${reconPct}%`, sub: `${reconciledOld} of ${olderThan7.length} payments`,
    target: "≥ 95%", status: statusFor(reconPct, 95, true), progress: reconPct,
    how: "Of remittance payments received more than 7 days ago, the share marked reconciled. Anything older than a week that's still open has missed the 7-day SLA.",
    source: "remittances.reconciled vs ingest date.",
  });

  // 2. Return documentation turnaround (lagging)
  const returns = (returnsRes.data ?? []).filter((r) => ["submitted", "credited", "closed"].includes(r.doc_status));
  const turnDays = returns.map((r) => (r.updated_at && r.created_at ? (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / DAY : null)).filter((n): n is number => n != null && n >= 0);
  const avgTurn = turnDays.length ? turnDays.reduce((a, b) => a + b, 0) / turnDays.length : null;
  maricel.push({
    key: "turnaround", label: "Return doc turnaround", icon: "🗂️", type: "lagging",
    display: avgTurn == null ? "—" : `${avgTurn.toFixed(1)} days`, sub: `${turnDays.length} documented returns (90d)`,
    target: "≤ 2 days", status: statusFor(avgTurn, 2, false), progress: avgTurn == null ? null : Math.max(0, Math.min(100, 100 - (avgTurn / 5) * 100)),
    how: "Average days from a return being logged to its documentation being completed (submitted / credited / closed), over the last 90 days.",
    source: "marketplace_returns (created → completed).",
  });

  // 3 + 4. Recovery rate % and total recovered AED (lagging — the money)
  const rec = summarizeRecovery(deductions);
  maricel.push({
    key: "recovery", label: "Deduction recovery rate", icon: "📈", type: "lagging",
    display: rec.recoveryPct == null ? "—" : `${rec.recoveryPct}%`,
    sub: `${formatAED(rec.totalApproved)} of ${formatAED(rec.totalClaimed)} claimed`,
    target: "≥ 80%", status: statusFor(rec.recoveryPct, 80, true), progress: rec.recoveryPct,
    how: "AED approved/recovered ÷ AED claimed across all remittance deductions Maricel has disputed.",
    source: "remittance_deductions (claim vs approved).",
  });
  maricel.push({
    key: "recovered_aed", label: "Total recovered", icon: "🏆", type: "lagging",
    display: formatAED(rec.totalApproved), sub: `from ${formatAED(rec.totalDeducted)} deducted by Amazon`,
    target: undefined, status: "none", progress: rec.totalDeducted > 0 ? Math.round((rec.totalApproved / rec.totalDeducted) * 100) : null,
    how: "Total AED recovered back from Amazon deductions — the money Maricel's reconciliation work brings back to the business.",
    source: "remittance_deductions.approved_amount_aed.",
  });

  return { aaron, maricel, period: "Rolling 30 days · chat 7d · recovery all-time" };
}
