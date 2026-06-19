import { supabase } from "@/lib/supabaseClient";

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

/** The Fri→Thu weeks spanning the cycle's quarter, each labelled by its Thursday
 *  ("week ending"). The first week may start a few days before the quarter. */
export function cycleWeeks(cycle: KpiCycle): { startIso: string; endIso: string; label: string }[] {
  const qStart = new Date(cycle.startIso);
  const qEnd = new Date(cycle.endIso);
  const first = new Date(qStart);
  first.setDate(first.getDate() - ((first.getDay() - 5 + 7) % 7)); // back to the Friday on/before
  first.setHours(0, 0, 0, 0);
  const out: { startIso: string; endIso: string; label: string }[] = [];
  for (const s = new Date(first); s < qEnd; s.setDate(s.getDate() + 7)) {
    const start = new Date(s);
    const end = new Date(s);
    end.setDate(end.getDate() + 7);
    const thu = new Date(end);
    thu.setDate(end.getDate() - 1);
    out.push({ startIso: start.toISOString(), endIso: end.toISOString(), label: thu.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) });
  }
  return out;
}

/** Read the shared cycle from app_settings (any signed-in user). Falls back to
 *  the current quarter. */
export async function fetchStoredCycle(): Promise<{ year: number; quarter: number }> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "kpi_cycle").maybeSingle();
    const v = (data as { value?: string | null } | null)?.value;
    if (v) {
      const p = JSON.parse(v) as { year?: number; quarter?: number };
      if (p.year && p.quarter) return { year: p.year, quarter: p.quarter };
    }
  } catch { /* ignore */ }
  return currentYearQuarter();
}

/** Save the shared cycle (manager only — enforced server-side). */
export async function saveCycle(year: number, quarter: number): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/kpi-cycle", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ year, quarter }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}
