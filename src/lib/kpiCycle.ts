/** KPI reporting cycle: a quarter (3 calendar months of a year) plus the current
 *  Friday→Thursday week. The quarter is manager-selectable on the scorecard. */
export interface KpiCycle {
  year: number;
  quarter: number; // 1–4
  startIso: string; // quarter start (inclusive)
  endIso: string; // quarter end (exclusive)
  label: string; // "Q3 2026"
  months: string; // "Jul–Sep"
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildCycle(year: number, quarter: number): KpiCycle {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 1, 0, 0, 0, 0);
  return {
    year,
    quarter,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label: `Q${quarter} ${year}`,
    months: `${MON[startMonth]}–${MON[startMonth + 2]}`,
  };
}

export function currentYearQuarter(): { year: number; quarter: number } {
  const d = new Date();
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
}

/** The current Friday→Thursday week (the working week cycle). */
export function friThuWeek(ref: Date = new Date()): { startIso: string; endIso: string; label: string } {
  const start = new Date(ref);
  const back = (start.getDay() - 5 + 7) % 7; // days since last Friday (Sun=0 … Fri=5)
  start.setDate(start.getDate() - back);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7); // exclusive — next Friday
  const thu = new Date(end);
  thu.setDate(end.getDate() - 1);
  const label = `Week ending Thu ${thu.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
  return { startIso: start.toISOString(), endIso: end.toISOString(), label };
}

const KEY = "kpi_cycle";
export function getStoredCycle(): { year: number; quarter: number } | null {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!v) return null;
    const p = JSON.parse(v) as { year?: number; quarter?: number };
    return p.year && p.quarter ? { year: p.year, quarter: p.quarter } : null;
  } catch {
    return null;
  }
}
export function storeCycle(year: number, quarter: number): void {
  try { localStorage.setItem(KEY, JSON.stringify({ year, quarter })); } catch { /* ignore */ }
}
