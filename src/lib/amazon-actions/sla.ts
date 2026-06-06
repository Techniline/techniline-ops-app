import type { SlaStatus } from "./types";

/** Whole days since an ISO timestamp. */
export function ageInDays(fromIso: string, now: number = Date.now()): number {
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** SLA band: 0–3 green · 4–7 amber · 8–14 red · 15+ escalated. */
export function slaStatus(ageDays: number): SlaStatus {
  if (ageDays >= 15) return "escalated";
  if (ageDays >= 8) return "red";
  if (ageDays >= 4) return "amber";
  return "green";
}
