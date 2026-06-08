import type { Cell, ReportTable } from "@/lib/export";

import type { CocobluInvoiceOverviewRow } from "./queries";
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

/* --------------------- Overview (per-invoice) KPIs --------------------- */

export interface CocobluOverviewKpis {
  openInvoices: number;
  openLines: number;
  totalRemainingQty: number;
  totalRemainingValue: number;
  storageRisk90: number; // invoices aged 90+ days (Cocoblu storage charges start)
}

/** KPI tiles from the per-invoice overview feed (covers all open stock). */
export function cocobluOverviewKpis(rows: CocobluInvoiceOverviewRow[]): CocobluOverviewKpis {
  let openInvoices = 0;
  let openLines = 0;
  let totalRemainingQty = 0;
  let totalRemainingValue = 0;
  let storageRisk90 = 0;
  for (const r of rows) {
    const rem = r.total_remaining_qty ?? 0;
    if (rem > 0) {
      openInvoices += 1;
      openLines += r.open_line_count ?? 0;
      totalRemainingQty += rem;
      totalRemainingValue += r.total_remaining_value ?? 0;
      if ((r.ageing_days ?? 0) >= 90) storageRisk90 += 1;
    }
  }
  return { openInvoices, openLines, totalRemainingQty, totalRemainingValue, storageRisk90 };
}

/** Cocoblu ageing lines as an exportable report (CSV + PDF share this dataset). */
export function cocobluReport(rows: CocobluAgeingRow[], generatedAt: string): ReportTable {
  const qty = rows.reduce((s, r) => s + (r.qty_remaining ?? 0), 0);
  const value = rows.reduce((s, r) => s + (r.qty_remaining ?? 0) * (r.unit_cost ?? 0), 0);
  const headers = [
    "Invoice", "Invoice Date", "Supplied Date", "SKU",
    "Qty Supplied", "Qty Remaining", "Unit Cost", "Value", "Age (d)", "Status",
  ];
  const body: Cell[][] = rows.map((r) => [
    r.invoice_number ?? "",
    r.invoice_date ?? "",
    r.supplied_date ?? "",
    r.sku ?? "",
    r.qty_supplied ?? 0,
    r.qty_remaining ?? 0,
    r.unit_cost ?? "",
    Number(((r.qty_remaining ?? 0) * (r.unit_cost ?? 0)).toFixed(2)),
    r.ageing_days ?? "",
    (r.ageing_status ?? "").replace(/_/g, " "),
  ]);
  return {
    title: "Cocoblu Ageing",
    subtitle: `Generated ${generatedAt} · ${rows.length} line${rows.length === 1 ? "" : "s"} · Remaining qty ${qty.toLocaleString()} · Value AED ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    headers,
    rows: body,
  };
}
