import { computeActionSummary, fetchAmazonActions } from "@/lib/amazon-actions";
import { fetchOpenBlockerStats } from "@/lib/blockers";
import { fetchBreachCountSince } from "@/lib/checklist";
import { fetchAllCocobluAgeing } from "@/lib/cocoblu";
import { renderTableReportHtml, type ReportTable } from "@/lib/export";
import { formatAED } from "@/lib/format";
import { fetchLpOverview } from "@/lib/lp";
import {
  computeMmKpis,
  fetchActionedThisMonth,
  fetchMmMetrics,
  fetchMmTarget,
  fetchRecoveredThisMonth,
  monthBounds,
  remainingWorkingDays,
} from "@/lib/musicmajlis";

export interface ManagerScorecard {
  monthLabel: string;
  // Music Majlis
  mmTarget: number;
  mmAchieved: number | null;
  mmPct: number | null;
  mmAbandoned: number | null;
  mmRecovered: number;
  mmRecoveryRate: number | null;
  mmConnected: boolean;
  // Holding-cost risk
  cocobluStorageRiskCount: number; // 90+ days
  cocobluStorageRiskValue: number;
  lpAged90Count: number; // LPOs aged 90+
  lpAged90Value: number;
  // Amazon
  amazonOpen: number;
  // Team
  openBlockers: number;
  oldestBlockerDays: number;
  checklistBreachesThisMonth: number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function currentMonthLabel(): string {
  const { monthStr } = monthBounds();
  const [y, m] = monthStr.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** Gather every manager-scorecard metric from the existing data layers. */
export async function buildManagerScorecard(): Promise<ManagerScorecard> {
  const { monthStr } = monthBounds();
  const [target, metrics, recovered, , cocoblu, lp, amazon, blockers, breaches] =
    await Promise.all([
      fetchMmTarget(),
      fetchMmMetrics(),
      fetchRecoveredThisMonth(),
      fetchActionedThisMonth(),
      fetchAllCocobluAgeing().catch(() => []),
      fetchLpOverview().catch(() => []),
      fetchAmazonActions().catch(() => []),
      fetchOpenBlockerStats().catch(() => ({ open: 0, oldestDays: 0 })),
      fetchBreachCountSince(`${monthStr}-01`).catch(() => 0),
    ]);

  const achieved = metrics?.netSales ?? 0;
  const k = computeMmKpis(target?.target_amount ?? 0, achieved, recovered);
  const connected = metrics?.configured === true;
  const abandoned = metrics?.abandonedCarts ?? null;

  // Cocoblu 90+ storage risk.
  let cocobluCount = 0;
  let cocobluValue = 0;
  for (const r of cocoblu) {
    if ((r.ageing_days ?? 0) >= 90 && (r.qty_remaining ?? 0) > 0) {
      cocobluCount += 1;
      cocobluValue += (r.qty_remaining ?? 0) * (r.unit_cost ?? 0);
    }
  }

  // LP LPOs aged 90+.
  let lpCount = 0;
  let lpValue = 0;
  for (const o of lp) {
    if ((o.ageing_days ?? 0) >= 90 && (o.open_line_count ?? 0) > 0) {
      lpCount += 1;
      lpValue += o.total_remaining_value ?? 0;
    }
  }

  const amazonSummary = computeActionSummary(amazon);

  return {
    monthLabel: currentMonthLabel(),
    mmTarget: target?.target_amount ?? 0,
    mmAchieved: connected ? achieved : null,
    mmPct: target?.target_amount ? Math.round(k.pct) : null,
    mmAbandoned: connected ? abandoned : null,
    mmRecovered: k.recoveredCount,
    mmRecoveryRate: connected && abandoned && abandoned > 0 ? Math.round((k.recoveredCount / abandoned) * 100) : null,
    mmConnected: connected,
    cocobluStorageRiskCount: cocobluCount,
    cocobluStorageRiskValue: Math.round(cocobluValue),
    lpAged90Count: lpCount,
    lpAged90Value: Math.round(lpValue),
    amazonOpen: amazonSummary.openCount,
    openBlockers: blockers.open,
    oldestBlockerDays: blockers.oldestDays,
    checklistBreachesThisMonth: breaches,
  };
}

const dash = (v: number | null, fmt?: (n: number) => string): string =>
  v == null ? "—" : fmt ? fmt(v) : String(v);

/** Build the email/preview tables from a scorecard. */
export function managerSummaryTables(s: ManagerScorecard): ReportTable[] {
  const sales: ReportTable = {
    title: `Music Majlis — Sales (${s.monthLabel})`,
    headers: ["Metric", "Value"],
    rows: [
      ["Monthly target", formatAED(s.mmTarget)],
      ["Achieved (net sales)", dash(s.mmAchieved, formatAED)],
      ["% of target", dash(s.mmPct, (n) => `${n}%`)],
      ["Today's target", formatAED(s.mmTarget ? Math.max(0, s.mmTarget - (s.mmAchieved ?? 0)) / Math.max(1, remainingWorkingDays()) : 0)],
      ["Abandoned carts", dash(s.mmAbandoned)],
      ["Recovered carts", String(s.mmRecovered)],
      ["Recovery rate", dash(s.mmRecoveryRate, (n) => `${n}%`)],
    ],
  };

  const risk: ReportTable = {
    title: "Holding-cost & action risk",
    headers: ["Area", "Value"],
    rows: [
      ["Cocoblu 90+ days (storage risk)", `${s.cocobluStorageRiskCount} lines · ${formatAED(s.cocobluStorageRiskValue)}`],
      ["LP aged 90+ days", `${s.lpAged90Count} LPOs · ${formatAED(s.lpAged90Value)}`],
      ["Amazon open actions", String(s.amazonOpen)],
    ],
  };

  const team: ReportTable = {
    title: "Team",
    headers: ["Metric", "Value"],
    rows: [
      ["Open blockers", `${s.openBlockers}${s.oldestBlockerDays ? ` (oldest ${s.oldestBlockerDays}d)` : ""}`],
      ["Checklist breaches this month", String(s.checklistBreachesThisMonth)],
    ],
  };

  return [sales, risk, team];
}

/** Full HTML email body for the monthly summary. */
export function renderManagerSummaryHtml(s: ManagerScorecard): string {
  const tables = managerSummaryTables(s)
    .map((t) => renderTableReportHtml(t))
    .join('<div style="height:18px"></div>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111">
    <h1 style="font-size:18px;margin:0 0 2px">Techniline — Monthly Operations Summary</h1>
    <p style="margin:0 0 16px;color:#666">${s.monthLabel}</p>
    ${tables}
    <p style="margin:18px 0 0;color:#999;font-size:11px">Generated automatically from Techniline Ops.</p>
  </div>`;
}
