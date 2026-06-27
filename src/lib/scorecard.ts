import { formatAED } from "@/lib/format";
import { cycleMonth, monthMetaFromKey, type KpiCycle } from "@/lib/kpiCycle";
import { AARON_ID, adjustedResponseMinutes, fetchBreaksForRange } from "@/lib/breaks";
import { fetchMmNetSalesRange, fetchMmTargetForMonth } from "@/lib/musicmajlis";
import { fetchDeductions, summarizeRecovery } from "@/lib/remittanceDeductions";
import { supabase } from "@/lib/supabaseClient";

/** One scorecard KPI, with everything the UI needs to render + explain it. */
export interface Kpi {
  key: string;
  label: string;
  icon: string;
  display: string; // formatted headline value
  sub?: string; // supporting context line
  target?: string; // e.g. "≥ 90%"
  status: "good" | "warn" | "bad" | "none";
  /** % of target attained, normalised so higher is always better. Drives the
   *  colour band: >120 blue · 100–119 green · 80–99 yellow · <80 red. */
  achievement: number | null;
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
/** Achievement % vs target, normalised so higher = better, capped at 200 so a
 *  tiny denominator (e.g. 0.07-day turnaround) can't produce a 7000% chip. */
const cap = (n: number) => Math.max(0, Math.min(200, Math.round(n)));
const achHB = (v: number | null, t: number) => (v == null ? null : cap((v / t) * 100)); // higher is better
const achLB = (v: number | null, t: number) => (v == null ? null : v <= 0 ? 200 : cap((t / v) * 100)); // lower is better

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

/** Compute the full KPI scorecard for Aaron + Maricel from live data, scoped to
 *  the given cycle (quarter) window. Fail-soft. */
export async function fetchScorecard(cycle: KpiCycle, mmMonthKey?: string): Promise<Scorecard> {
  const now = Date.now();
  const qStart = cycle.startIso;
  const qEnd = cycle.endIso;
  // MM sales target is set per calendar month, so this one KPI is scoped to a
  // single month — the explicitly-picked month, else the cycle's default month.
  const sm = mmMonthKey ? monthMetaFromKey(mmMonthKey) : cycleMonth(cycle);

  // ── shared fetches, all scoped to the cycle quarter ──────────────────────────
  const [chatRows, aaronBreaks, ordersRes, mmSales, mmTarget, recoveredRes, abandonedRes, remitRes, docsRes, deductions] =
    await Promise.all([
      // Chat: fetch actual rows so we can adjust response_minutes for break windows.
      supabase.from("wazzup_messages").select("message_at, response_minutes").eq("direction", "inbound").not("response_minutes", "is", null).gte("message_at", qStart).lt("message_at", qEnd).limit(5000),
      fetchBreaksForRange(AARON_ID, qStart, qEnd).catch(() => []),
      supabase.from("shopify_orders").select("logistics_status, fulfillment_status").gte("shopify_created_at", qStart).lt("shopify_created_at", qEnd),
      fetchMmNetSalesRange(sm.startIso, sm.endIso).catch(() => null),
      fetchMmTargetForMonth(sm.monthKey).catch(() => null),
      supabase.from("mm_recovered_carts").select("amount").gte("recovered_date", qStart.slice(0, 10)).lt("recovered_date", qEnd.slice(0, 10)),
      supabase.from("mm_abandoned_actions").select("*", { count: "exact", head: true }).gte("created_at", qStart).lt("created_at", qEnd),
      supabase.from("remittances").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("seller_order_docs").select("*", { count: "exact", head: true }).or("invoice_number.not.is.null,prt_number.not.is.null,srt_number.not.is.null"),
      fetchDeductions({ includeClosed: true }).catch(() => []),
    ]);

  // ── AARON ────────────────────────────────────────────────────────────────
  // 1. Chat reply within 15 min — adjusted for break windows.
  const chats = chatRows.data ?? [];
  const chatTotal = chats.length;
  const chatWithin = chats.filter((c) => {
    const adj = adjustedResponseMinutes(c.message_at as string, c.response_minutes as number, aaronBreaks);
    return adj != null && adj <= 15;
  }).length;
  const chatPct = pct(chatWithin, chatTotal);
  const aaron: Kpi[] = [];
  aaron.push({
    key: "chat15", label: "Chat reply within 15 min", icon: "💬", type: "lagging",
    display: chatPct == null ? "—" : `${chatPct}%`,
    sub: chatTotal ? `${chatWithin} of ${chatTotal} replies` : "no data yet",
    target: "≥ 90%", status: statusFor(chatPct, 90, true), achievement: achHB(chatPct, 90), progress: chatPct,
    how: "Inbound WhatsApp messages answered in under 15 minutes ÷ all answered messages, within the selected quarter.",
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
    display: actionRate == null ? "—" : `${actionRate}%`, sub: `${actioned} of ${live.length} orders`,
    target: "≥ 90%", status: statusFor(actionRate, 90, true), achievement: achHB(actionRate, 90), progress: actionRate,
    how: "Orders moved past “New Order” (picked / dispatched / advanced) ÷ all non-cancelled orders created in the selected quarter. A leading sign that nothing is sitting untouched.",
    source: "shopify_orders.logistics_status.",
  });
  aaron.push({
    key: "fulfil", label: "Fulfillment rate", icon: "📦", type: "lagging",
    display: fulfilRate == null ? "—" : `${fulfilRate}%`, sub: `${fulfilled} of ${live.length} orders`,
    target: "≥ 95%", status: statusFor(fulfilRate, 95, true), achievement: achHB(fulfilRate, 95), progress: fulfilRate,
    how: "Non-cancelled orders marked fulfilled ÷ all non-cancelled orders created in the selected quarter.",
    source: "shopify_orders.fulfillment_status (derived from line-item fulfillment).",
  });

  // 4. Abandoned-cart recovery (lagging) — recovered carts vs abandoned, in the quarter.
  const recovered = recoveredRes.data ?? [];
  const recoveredCount = recovered.length;
  const recoveredAed = recovered.reduce((s, r) => s + ((r as { amount?: number }).amount ?? 0), 0);
  const abandoned = abandonedRes.count ?? 0;
  const recoveryRate = abandoned > 0 ? pct(recoveredCount, abandoned) : null;
  aaron.push({
    key: "cart", label: "Abandoned-cart recovery", icon: "🛒", type: "lagging",
    display: recoveryRate == null ? `${recoveredCount} carts` : `${recoveryRate}%`,
    sub: `${recoveredCount} recovered · ${formatAED(recoveredAed)}${abandoned ? ` of ${abandoned} abandoned` : ""}`,
    target: "≥ 20%", status: recoveryRate == null ? "none" : statusFor(recoveryRate, 20, true), achievement: achHB(recoveryRate, 20), progress: recoveryRate,
    how: "Abandoned carts recovered ÷ abandoned checkouts worked, within the selected quarter. Value = AED of the recovered carts.",
    source: "mm_recovered_carts + mm_abandoned_actions.",
  });

  // 5. MM sales vs MONTHLY target (lagging) — the target is set per calendar
  //    month, so we compare this month's net sales against this month's target.
  const target = mmTarget ?? null;
  const mmPct = target && target > 0 && mmSales != null ? Math.round((mmSales / target) * 100) : null;
  aaron.push({
    key: "mmsales", label: `MusicMajlis sales (${sm.label})`, icon: "💰", type: "lagging",
    display: mmSales == null ? "—" : formatAED(mmSales),
    sub: target ? `${mmPct ?? 0}% of ${formatAED(target)} ${sm.label} target` : `no target set for ${sm.label}`,
    target: target ? "100% of target" : undefined, status: mmPct == null ? "none" : statusFor(mmPct, 100, true), achievement: mmPct, progress: mmPct == null ? null : Math.min(100, mmPct),
    how: `Shopify net sales for MusicMajlis in ${sm.label}, vs ${sm.label}'s sales target. Scoped to the month because the target is set per month (not per quarter).`,
    source: "Shopify net sales + mm_targets (the month's target).",
  });

  // ── MARICEL ──────────────────────────────────────────────────────────────
  const maricel: Kpi[] = [];
  // 1. Reconciliation within 3-day SLA (leading) — measured from the REAL
  //    reviewed_at timestamp (stamped on "Mark reviewed"). Last 30 days of real
  //    Amazon payment remittances. Legacy rows reviewed before timestamp tracking
  //    (reconciled but no reviewed_at) are EXCLUDED — never guessed.
  const inCycle = (t: string | null | undefined) => !!t && t >= qStart && t < qEnd; // ISO compare
  const remits = (remitRes.data ?? []).filter(
    (r) => r.remittance_ref && /^\d{6,}$/.test(r.remittance_ref) && inCycle(r.created_at)
  );
  let onTimeR = 0, lateR = 0, openBreach = 0;
  for (const r of remits) {
    const created = new Date(r.created_at as string).getTime();
    if (r.reviewed_at) {
      const days = (new Date(r.reviewed_at).getTime() - created) / DAY;
      if (days <= 3) onTimeR += 1; else lateR += 1;
    } else if (r.reconciled === true) {
      continue; // reviewed before timestamp tracking — unknown timing, excluded
    } else if (now - created > 3 * DAY) {
      openBreach += 1; // genuinely open past the 3-day SLA
    } // else: open but still within 3 days — in-flight, not yet judged
  }
  const counted = onTimeR + lateR + openBreach;
  const reconPct = pct(onTimeR, counted);
  maricel.push({
    key: "recon", label: "Reconciliation 3-day SLA", icon: "✅", type: "leading",
    display: counted === 0 ? "—" : `${reconPct}%`,
    sub: counted === 0 ? "no reviews recorded yet" : `${onTimeR} on time · ${lateR} late · ${openBreach} open >3 days`,
    target: "≥ 95%", status: statusFor(reconPct, 95, true), achievement: achHB(reconPct, 95), progress: reconPct,
    how: "Reviewed within 3 days of receipt, from the real timestamp stamped on “Mark reviewed”. Amazon payment remittances received in the selected quarter. Payments reviewed before timestamp tracking are excluded (never guessed).",
    source: "remittances.reviewed_at vs ingest date.",
  });

  // 2. Return documentation completed (leading) — the Amazon return paperwork
  //    (invoice / PRT / SRT) Maricel maintains on the Amazon Fulfillment page.
  // Counts via count-queries (not fetched rows) so the 1000-row cap can't undercount.
  const documented = docsRes.count ?? 0;
  const { count: docClosed } = await supabase.from("seller_order_docs").select("*", { count: "exact", head: true }).eq("doc_status", "Closed");
  maricel.push({
    key: "docs", label: "Return docs prepared", icon: "🗂️", type: "leading",
    display: `${documented}`, sub: `orders with invoice/PRT/SRT${docClosed ? ` · ${docClosed} closed` : ""}`,
    target: undefined, status: "none", achievement: null, progress: null,
    how: "Amazon orders where Maricel has filled return paperwork (invoice number, PRT, or SRT). Counts her actual documentation output, not the status flag.",
    source: "seller_order_docs (invoice_number / prt_number / srt_number).",
  });

  // 3. Deduction turnaround — avg days from a deduction appearing to Maricel
  //    closing it (real timestamps), last 90 days. (lagging)
  const closedDed = deductions.filter((d) => d.status === "closed" && inCycle(d.closed_at as string | null) && d.created_at);
  const dedDays = closedDed.map((d) => (new Date(d.closed_at as string).getTime() - new Date(d.created_at).getTime()) / DAY).filter((n) => n >= 0);
  const avgDed = dedDays.length ? dedDays.reduce((a, b) => a + b, 0) / dedDays.length : null;
  maricel.push({
    key: "ded_turn", label: "Deduction turnaround", icon: "⏱️", type: "lagging",
    display: avgDed == null ? "—" : `${avgDed.toFixed(1)} days`, sub: `${dedDays.length} closed this quarter`,
    target: "≤ 5 days", status: statusFor(avgDed, 5, false), achievement: achLB(avgDed, 5), progress: avgDed == null ? null : Math.max(0, Math.min(100, 100 - (avgDed / 10) * 100)),
    how: "Average days from a deduction appearing on a remittance to Maricel closing (documenting) it, for deductions closed in the selected quarter.",
    source: "remittance_deductions (created_at → closed_at).",
  });

  // 3 + 4. Recovery rate % and total recovered AED (lagging — the money)
  const rec = summarizeRecovery(deductions.filter((d) => inCycle(d.created_at)));
  maricel.push({
    key: "recovery", label: "Deduction recovery rate", icon: "📈", type: "lagging",
    display: rec.recoveryPct == null ? "—" : `${rec.recoveryPct}%`,
    sub: rec.totalClaimed > 0 ? `${formatAED(rec.totalApproved)} of ${formatAED(rec.totalClaimed)} claimed` : "no claims entered yet",
    target: "≥ 80%", status: statusFor(rec.recoveryPct, 80, true), achievement: achHB(rec.recoveryPct, 80), progress: rec.recoveryPct,
    how: "AED approved/recovered ÷ AED claimed across all remittance deductions Maricel has disputed.",
    source: "remittance_deductions (claim vs approved).",
  });
  maricel.push({
    key: "recovered_aed", label: "Total recovered", icon: "🏆", type: "lagging",
    display: formatAED(rec.totalApproved), sub: `from ${formatAED(rec.totalDeducted)} deducted by Amazon`,
    target: undefined, status: "none", achievement: null, progress: rec.totalDeducted > 0 ? Math.round((rec.totalApproved / rec.totalDeducted) * 100) : null,
    how: "Total AED recovered back from Amazon deductions — the money Maricel's reconciliation work brings back to the business.",
    source: "remittance_deductions.approved_amount_aed.",
  });

  return { aaron, maricel, period: `${cycle.label} (${cycle.months}) — quarter-scoped, except MusicMajlis sales (${sm.label}, monthly target)` };
}
