import { cycleWeeks, type KpiCycle } from "@/lib/kpiCycle";
import { AARON_ID, adjustedResponseMinutes, fetchBreaksForRange } from "@/lib/breaks";
import { fetchMmDailyRange, fetchMmTargetQuarterTotal } from "@/lib/musicmajlis";
import { fetchDeductions } from "@/lib/remittanceDeductions";
import { supabase } from "@/lib/supabaseClient";

/** One KPI row in the weekly grid: a value per Fri–Thu week plus the QTD total. */
export interface WeeklyRow {
  person: "Aaron" | "Maricel";
  label: string;
  uom: string; // "%" | "AED" | "days" | "count"
  targetValue: number; // numeric target (for the colour band)
  higherIsBetter: boolean;
  weekly: (number | null)[]; // one per week (same order as `weeks`)
  qtd: number | null; // quarter-to-date
}

export interface WeeklyScorecard {
  weeks: string[]; // week-ending labels (column headers)
  weekRanges: { startIso: string; endIso: string }[];
  rows: WeeklyRow[];
}

const within = (t: string | null | undefined, s: string, e: string) => !!t && t >= s && t < e;
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

/** Compute the per-week KPI grid for the cycle's quarter (company-sheet style). */
export async function fetchWeeklyScorecard(cycle: KpiCycle): Promise<WeeklyScorecard> {
  const weeks = cycleWeeks(cycle);
  const qStart = cycle.startIso;
  const qEnd = cycle.endIso;
  const ranges = weeks.map((w) => ({ startIso: w.startIso, endIso: w.endIso }));
  const all = { startIso: qStart, endIso: qEnd };
  const now = Date.now();
  const DAY = 86_400_000;

  // ── raw data for the whole quarter (bucketed in JS) ──────────────────────────
  const [chatRows, aaronBreaks, orders, mmDaily, mmTarget, recovered, abandoned, remits, deductions] = await Promise.all([
    supabase.from("wazzup_messages").select("message_at, response_minutes").eq("direction", "inbound").not("response_minutes", "is", null).gte("message_at", qStart).lt("message_at", qEnd).limit(5000),
    fetchBreaksForRange(AARON_ID, qStart, qEnd).catch(() => []),
    supabase.from("shopify_orders").select("shopify_created_at, logistics_status, fulfillment_status").gte("shopify_created_at", qStart).lt("shopify_created_at", qEnd).limit(5000),
    fetchMmDailyRange(qStart, qEnd).catch(() => ({})),
    fetchMmTargetQuarterTotal(cycle.year, cycle.quarter).catch(() => null),
    supabase.from("mm_recovered_carts").select("recovered_date").gte("recovered_date", qStart.slice(0, 10)).lt("recovered_date", qEnd.slice(0, 10)).limit(5000),
    supabase.from("mm_abandoned_actions").select("created_at").gte("created_at", qStart).lt("created_at", qEnd).limit(5000),
    supabase.from("remittances").select("remittance_ref, reconciled, reviewed_at, created_at").limit(2000),
    fetchDeductions({ includeClosed: true }).catch(() => []),
  ]);

  const chat = chatRows.data ?? [];
  const ord = orders.data ?? [];
  const rec = recovered.data ?? [];
  const ab = abandoned.data ?? [];
  const rem = (remits.data ?? []).filter((r) => r.remittance_ref && /^\d{6,}$/.test(r.remittance_ref));

  // per-window calculators
  const chatPct = (s: string, e: string) => {
    const inWin = chat.filter((r) => within(r.message_at, s, e));
    return pct(
      inWin.filter((r) => {
        const adj = adjustedResponseMinutes(r.message_at as string, r.response_minutes as number, aaronBreaks);
        return adj != null && adj <= 15;
      }).length,
      inWin.length
    );
  };
  const orderRate = (s: string, e: string, fulfilled: boolean) => {
    const live = ord.filter((o) => within(o.shopify_created_at, s, e) && o.logistics_status !== "cancelled");
    const num = fulfilled ? live.filter((o) => o.fulfillment_status === "fulfilled").length : live.filter((o) => o.logistics_status !== "new_order").length;
    return pct(num, live.length);
  };
  const cartPct = (s: string, e: string) => {
    const a = ab.filter((r) => within(r.created_at, s, e)).length;
    const r = rec.filter((x) => { const d = (x.recovered_date as string)?.slice(0, 10); return d && d >= s.slice(0, 10) && d < e.slice(0, 10); }).length;
    return a > 0 ? pct(r, a) : null;
  };
  const mmSales = (s: string, e: string) => {
    let sum = 0; let any = false;
    for (const [day, v] of Object.entries(mmDaily)) {
      const iso = `${day}T00:00:00.000Z`;
      if (iso >= s && iso < e) { sum += v ?? 0; any = true; }
    }
    return any || Object.keys(mmDaily).length ? Math.round(sum) : null;
  };
  const reconPct = (s: string, e: string) => {
    const inWin = rem.filter((r) => within(r.created_at, s, e));
    let onTime = 0, counted = 0;
    for (const r of inWin) {
      const created = new Date(r.created_at as string).getTime();
      if (r.reviewed_at) { counted += 1; if ((new Date(r.reviewed_at).getTime() - created) / DAY <= 3) onTime += 1; }
      else if (r.reconciled === true) { /* legacy, excluded */ }
      else if (now - created > 3 * DAY) { counted += 1; } // breach
    }
    return pct(onTime, counted);
  };
  const recoveryPct = (s: string, e: string) => {
    const inWin = deductions.filter((d) => within(d.created_at, s, e));
    const claimed = inWin.reduce((a, d) => a + (d.claim_amount_aed ?? 0), 0);
    const approved = inWin.reduce((a, d) => a + (d.approved_amount_aed ?? 0), 0);
    return claimed > 0 ? Math.round((approved / claimed) * 100) : null;
  };
  const turnaround = (s: string, e: string) => {
    const closed = deductions.filter((d) => d.status === "closed" && within(d.closed_at, s, e) && d.created_at);
    const days = closed.map((d) => (new Date(d.closed_at as string).getTime() - new Date(d.created_at).getTime()) / DAY).filter((n) => n >= 0);
    return days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null;
  };

  const buildRow = (person: WeeklyRow["person"], label: string, uom: string, targetValue: number, higherIsBetter: boolean, fn: (s: string, e: string) => number | null): WeeklyRow => ({
    person, label, uom, targetValue, higherIsBetter,
    weekly: ranges.map((r) => fn(r.startIso, r.endIso)),
    qtd: fn(all.startIso, all.endIso),
  });

  const rows: WeeklyRow[] = [
    buildRow("Aaron", "Chat reply < 15 min", "%", 90, true, chatPct),
    buildRow("Aaron", "Order action rate", "%", 90, true, (s, e) => orderRate(s, e, false)),
    buildRow("Aaron", "Fulfillment rate", "%", 95, true, (s, e) => orderRate(s, e, true)),
    buildRow("Aaron", "Abandoned-cart recovery", "%", 20, true, cartPct),
    buildRow("Aaron", `MM sales (${cycle.label} target ${mmTarget ? `${(mmTarget / 1000).toFixed(0)}k` : "—"})`, "AED", 1, true, mmSales),
    buildRow("Maricel", "Reconciliation 3-day SLA", "%", 95, true, reconPct),
    buildRow("Maricel", "Deduction recovery rate", "%", 80, true, recoveryPct),
    buildRow("Maricel", "Deduction turnaround", "days", 5, false, turnaround),
  ];

  return { weeks: weeks.map((w) => w.label), weekRanges: ranges, rows };
}
