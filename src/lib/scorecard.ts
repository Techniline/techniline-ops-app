import { formatAED } from "@/lib/format";
import { fetchMmMetrics, fetchMmTarget, fetchRecoveredThisMonth } from "@/lib/musicmajlis";
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

  // ── shared fetches (reuse the same sources the dashboard uses) ───────────────
  const [wz, ordersRes, mmMetrics, mmTarget, recoveredCarts, remitRes, docsRes, deductions] =
    await Promise.all([
      fetchWazzupStats().catch(() => null),
      supabase.from("shopify_orders").select("logistics_status, fulfillment_status").gte("shopify_created_at", since30),
      fetchMmMetrics().catch(() => null),
      fetchMmTarget().catch(() => null),
      fetchRecoveredThisMonth().catch(() => []),
      supabase.from("remittances").select("remittance_ref, reconciled, created_at"),
      supabase.from("seller_order_docs").select("invoice_number, prt_number, srt_number, doc_status"),
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

  // 4. Abandoned-cart recovery (lagging) — recovered carts (this month) vs the
  //    month's abandoned-cart count from Shopify.
  const abandoned = mmMetrics?.abandonedCarts ?? null;
  const recoveredCount = recoveredCarts.length;
  const recoveredAed = recoveredCarts.reduce((s, r) => s + (r.amount ?? 0), 0);
  const recoveryRate = abandoned && abandoned > 0 ? pct(recoveredCount, abandoned) : null;
  aaron.push({
    key: "cart", label: "Abandoned-cart recovery", icon: "🛒", type: "lagging",
    display: recoveryRate == null ? `${recoveredCount} carts` : `${recoveryRate}%`,
    sub: `${recoveredCount} recovered · ${formatAED(recoveredAed)}${abandoned != null ? ` of ${abandoned} abandoned` : ""} (this month)`,
    target: "≥ 20%", status: recoveryRate == null ? "none" : statusFor(recoveryRate, 20, true), progress: recoveryRate,
    how: "Recovered carts logged this month ÷ Shopify abandoned checkouts this month. Value = AED of the recovered carts.",
    source: "mm_recovered_carts + Shopify abandoned-cart metric.",
  });

  // 5. MM sales vs monthly target (lagging) — Shopify net sales (same as dashboard)
  const mmSales = mmMetrics?.netSales ?? null;
  const target = mmTarget?.target_amount ?? null;
  const mmPct = target && target > 0 && mmSales != null ? Math.round((mmSales / target) * 100) : null;
  aaron.push({
    key: "mmsales", label: "MusicMajlis sales (month)", icon: "💰", type: "lagging",
    display: mmSales == null ? "—" : formatAED(mmSales),
    sub: target ? `${mmPct ?? 0}% of ${formatAED(target)} target` : "no target set this month",
    target: target ? "100% of target" : undefined, status: mmPct == null ? "none" : statusFor(mmPct, 100, true), progress: mmPct == null ? null : Math.min(100, mmPct),
    how: "Shopify net sales for MusicMajlis this calendar month (the dashboard figure), compared to the month's sales target.",
    source: "Shopify net sales + mm_targets.",
  });

  // ── MARICEL ──────────────────────────────────────────────────────────────
  const maricel: Kpi[] = [];
  // 1. Reconciliation within 3-day SLA (leading) — a payment must be marked
  //    reviewed within 3 days; one left open >3 days is a breach.
  // Only real Amazon payment remittances (6+ digit refs) — drops "Payment Advice"
  // and other non-payment rows so the SLA population is genuine, matching the band.
  const remits = (remitRes.data ?? []).filter((r) => r.remittance_ref && /^\d{6,}$/.test(r.remittance_ref));
  const olderThan3 = remits.filter((r) => r.created_at && now - new Date(r.created_at).getTime() > 3 * DAY);
  const reviewedOld = olderThan3.filter((r) => r.reconciled === true).length;
  const breaches = olderThan3.length - reviewedOld; // open > 3 days, not reviewed
  const reconPct = pct(reviewedOld, olderThan3.length);
  maricel.push({
    key: "recon", label: "Reconciliation 3-day SLA", icon: "✅", type: "leading",
    display: reconPct == null ? "—" : `${reconPct}%`,
    sub: `${reviewedOld} of ${olderThan3.length} reviewed · ${breaches} open >3 days`,
    target: "≥ 95%", status: statusFor(reconPct, 95, true), progress: reconPct,
    how: "Of remittance payments received more than 3 days ago, the share marked reviewed. Any payment still open (not reviewed) after 3 days is an SLA breach — shown as the “open >3 days” count.",
    source: "remittances.reconciled (Mark reviewed) vs ingest date.",
  });

  // 2. Return documentation completed (leading) — the Amazon return paperwork
  //    (invoice / PRT / SRT) Maricel maintains on the Amazon Fulfillment page.
  const docs = docsRes.data ?? [];
  const documented = docs.filter((d) => d.invoice_number || d.prt_number || d.srt_number).length;
  const docClosed = docs.filter((d) => d.doc_status === "Closed").length;
  maricel.push({
    key: "docs", label: "Return docs prepared", icon: "🗂️", type: "leading",
    display: `${documented}`, sub: `orders with invoice/PRT/SRT${docClosed ? ` · ${docClosed} closed` : ""}`,
    target: undefined, status: "none", progress: null,
    how: "Amazon orders where Maricel has filled return paperwork (invoice number, PRT, or SRT). Counts her actual documentation output, not the status flag.",
    source: "seller_order_docs (invoice_number / prt_number / srt_number).",
  });

  // 3. Deduction turnaround — avg days from a deduction appearing to Maricel
  //    closing it (real timestamps), last 90 days. (lagging)
  const closedDed = deductions.filter((d) => d.status === "closed" && d.closed_at && d.created_at && now - new Date(d.closed_at as string).getTime() <= 90 * DAY);
  const dedDays = closedDed.map((d) => (new Date(d.closed_at as string).getTime() - new Date(d.created_at).getTime()) / DAY).filter((n) => n >= 0);
  const avgDed = dedDays.length ? dedDays.reduce((a, b) => a + b, 0) / dedDays.length : null;
  maricel.push({
    key: "ded_turn", label: "Deduction turnaround", icon: "⏱️", type: "lagging",
    display: avgDed == null ? "—" : `${avgDed.toFixed(1)} days`, sub: `${dedDays.length} closed (90d)`,
    target: "≤ 5 days", status: statusFor(avgDed, 5, false), progress: avgDed == null ? null : Math.max(0, Math.min(100, 100 - (avgDed / 10) * 100)),
    how: "Average days from a deduction appearing on a remittance to Maricel closing (documenting) it, over the last 90 days.",
    source: "remittance_deductions (created_at → closed_at).",
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
