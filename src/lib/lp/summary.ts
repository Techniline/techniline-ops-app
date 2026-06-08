import type { LpItemRow } from "./queries";

export interface LpSummary {
  openLines: number; // lines with stock remaining
  openLpCount: number; // distinct LPs with stock remaining
  totalRemainingQty: number;
  totalRemainingValue: number; // qty_remaining * unit_price
  aged90Lines: number; // remaining stock aged 90+ days
}

function remaining(r: LpItemRow): number {
  return r.qty_remaining ?? 0;
}

/** Aggregate view rows into the KPI figures shown on the page + dashboard. */
export function computeLpSummary(rows: LpItemRow[]): LpSummary {
  let openLines = 0;
  let totalRemainingQty = 0;
  let totalRemainingValue = 0;
  let aged90Lines = 0;
  const openLps = new Set<string>();

  for (const r of rows) {
    const rem = remaining(r);
    if (rem > 0) {
      openLines += 1;
      totalRemainingQty += rem;
      totalRemainingValue += rem * (r.unit_price ?? 0);
      if (r.lp_id) openLps.add(r.lp_id);
      if ((r.ageing_days ?? 0) >= 90) aged90Lines += 1;
    }
  }

  return {
    openLines,
    openLpCount: openLps.size,
    totalRemainingQty,
    totalRemainingValue,
    aged90Lines,
  };
}

/** One stock-in-hand row for the report (email + PDF export). */
export interface SnapshotLine {
  lpNumber: string | null;
  lpDate: string | null;
  vendorName: string | null;
  modelNo: string | null;
  description: string | null;
  qtyRemaining: number;
  unitPrice: number | null;
  value: number;
  ageingDays: number | null;
  ageingStatus: string | null;
}

/** Point-in-time stock-in-hand snapshot (lines with remaining > 0), oldest first. */
export function buildStockSnapshot(rows: LpItemRow[]): SnapshotLine[] {
  return rows
    .filter((r) => remaining(r) > 0)
    .map((r) => ({
      lpNumber: r.lp_number,
      lpDate: r.lp_date,
      vendorName: r.vendor_name,
      modelNo: r.model_no ?? r.sku,
      description: r.description,
      qtyRemaining: remaining(r),
      unitPrice: r.unit_price,
      value: remaining(r) * (r.unit_price ?? 0),
      ageingDays: r.ageing_days,
      ageingStatus: r.ageing_status,
    }))
    .sort((a, b) => (b.ageingDays ?? 0) - (a.ageingDays ?? 0));
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Render the stock-in-hand snapshot as a standalone HTML report — used for both
 * the email body and the print-to-PDF export. `generatedAt` is supplied by the
 * caller (so this stays pure / testable).
 */
export function renderStockReportHtml(lines: SnapshotLine[], generatedAt: string): string {
  const totalQty = lines.reduce((s, l) => s + l.qtyRemaining, 0);
  const totalValue = lines.reduce((s, l) => s + l.value, 0);

  const rows = lines
    .map(
      (l) => `<tr>
        <td>${esc(l.lpNumber ?? "—")}</td>
        <td>${esc(l.lpDate ?? "—")}</td>
        <td>${esc(l.vendorName ?? "—")}</td>
        <td>${esc(l.modelNo ?? "—")}</td>
        <td>${esc(l.description ?? "")}</td>
        <td style="text-align:right">${l.qtyRemaining.toLocaleString()}</td>
        <td style="text-align:right">${l.unitPrice == null ? "—" : fmt(l.unitPrice)}</td>
        <td style="text-align:right">${fmt(l.value)}</td>
        <td style="text-align:right">${l.ageingDays ?? "—"}</td>
        <td>${esc((l.ageingStatus ?? "").replace(/_/g, " "))}</td>
      </tr>`
    )
    .join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111">
    <h2 style="margin:0 0 4px">Local Purchase — Stock in Hand</h2>
    <p style="margin:0 0 12px;color:#666">Generated ${esc(generatedAt)} · ${lines.length} open line${lines.length === 1 ? "" : "s"} · Qty ${totalQty.toLocaleString()} · Value AED ${fmt(totalValue)}</p>
    <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px">
      <thead>
        <tr style="background:#f1f5f9;text-align:left">
          <th>LP No</th><th>LP Date</th><th>Vendor</th><th>Model</th><th>Description</th>
          <th style="text-align:right">Qty</th><th style="text-align:right">Unit</th>
          <th style="text-align:right">Value</th><th style="text-align:right">Age (d)</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="10" style="text-align:center;color:#888">No stock in hand.</td></tr>`}</tbody>
    </table>
  </div>`;
}
