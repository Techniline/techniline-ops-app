import type { CocobluAgeingRow, CocobluSummary } from "./types";

/**
 * Aggregate ageing-view rows into summary figures.
 *
 * Bucketing follows the view's `ageing_status` semantics:
 * - `monitor`         → 61–75 day band
 * - `warning`         → 76–89 day band
 * - `action_required` → 90+ day band (also captured by `ageing_days >= 90`)
 */
export function calculateCocobluSummary(
  rows: CocobluAgeingRow[]
): CocobluSummary {
  let totalOpenRecords = 0;
  let over90Records = 0;
  let warningRecords = 0;
  let totalQtyRemaining = 0;
  let qty90Plus = 0;
  let qty76To89 = 0;
  let qty61To75 = 0;

  for (const row of rows) {
    const qty = row.qty_remaining ?? 0;
    const ageingDays = row.ageing_days;
    const ageingStatus = row.ageing_status;

    if (row.status !== "closed") {
      totalOpenRecords += 1;
    }

    if (ageingDays !== null && ageingDays >= 90) {
      over90Records += 1;
      qty90Plus += qty;
    }

    if (ageingStatus === "warning" || ageingStatus === "action_required") {
      warningRecords += 1;
    }

    if (ageingStatus === "warning") {
      qty76To89 += qty;
    }

    if (ageingStatus === "monitor") {
      qty61To75 += qty;
    }

    totalQtyRemaining += qty;
  }

  return {
    totalOpenRecords,
    over90Records,
    warningRecords,
    totalQtyRemaining,
    qty90Plus,
    qty76To89,
    qty61To75,
  };
}
