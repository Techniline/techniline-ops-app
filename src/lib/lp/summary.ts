import type { Cell, ReportTable } from "@/lib/export";

import type { SaleReportRow } from "./queries";
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

  return { openLines, openLpCount: openLps.size, totalRemainingQty, totalRemainingValue, aged90Lines };
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Resolve the display name for a sale's entity ("Other" → typed name). */
export function entityLabel(entity: string | null, entityOther: string | null): string {
  if (entity === "Other") return entityOther?.trim() || "Other";
  return entity ?? "—";
}

/* --------------------------- LP line reports ---------------------------- */

const LINE_HEADERS = [
  "LP No", "LP Date", "Vendor", "Model", "Brand", "Description",
  "Purchased", "Sold", "Remaining", "Unit Price", "Value", "Age (d)", "Status",
] as const;

function lineRow(r: LpItemRow): Cell[] {
  const rem = remaining(r);
  return [
    r.lp_number ?? "",
    r.lp_date ?? "",
    r.vendor_name ?? "",
    r.model_no ?? r.sku ?? "",
    r.brand ?? "",
    r.description ?? "",
    r.qty_purchased ?? 0,
    r.qty_sold ?? 0,
    rem,
    r.unit_price ?? "",
    Number((rem * (r.unit_price ?? 0)).toFixed(2)),
    r.ageing_days ?? "",
    (r.ageing_status ?? "").replace(/_/g, " "),
  ];
}

function lineSubtitle(rows: LpItemRow[], generatedAt: string): string {
  const qty = rows.reduce((s, r) => s + remaining(r), 0);
  const value = rows.reduce((s, r) => s + remaining(r) * (r.unit_price ?? 0), 0);
  return `Generated ${generatedAt} · ${rows.length} line${rows.length === 1 ? "" : "s"} · Remaining qty ${qty.toLocaleString()} · Value AED ${fmt(value)}`;
}

/** The lines currently shown on screen (already filtered by the page). */
export function currentViewReport(rows: LpItemRow[], generatedAt: string): ReportTable {
  return {
    title: "LP Tracker — Current View",
    subtitle: lineSubtitle(rows, generatedAt),
    headers: [...LINE_HEADERS],
    rows: rows.map(lineRow),
  };
}

/** Stock-in-hand (lines with remaining > 0), oldest first — for the email + report. */
export function stockInHandReport(rows: LpItemRow[], generatedAt: string): ReportTable {
  const inHand = rows
    .filter((r) => remaining(r) > 0)
    .sort((a, b) => (b.ageing_days ?? 0) - (a.ageing_days ?? 0));
  return {
    title: "Local Purchase — Stock in Hand",
    subtitle: lineSubtitle(inHand, generatedAt),
    headers: [...LINE_HEADERS],
    rows: inHand.map(lineRow),
  };
}

/** Vendor (or "All") + LP-date range, full line status. */
export function vendorReport(
  rows: LpItemRow[],
  vendor: string,
  fromIso: string,
  toIso: string,
  generatedAt: string
): ReportTable {
  const sel = rows.filter((r) => {
    if (vendor !== "All" && (r.vendor_name ?? "") !== vendor) return false;
    const d = r.lp_date ?? "";
    if (fromIso && d < fromIso) return false;
    if (toIso && d > toIso) return false;
    return true;
  });
  const range = `${fromIso || "…"} → ${toIso || "…"}`;
  return {
    title: "LP Tracker — Vendor / Date Report",
    subtitle: `${vendor === "All" ? "All vendors" : vendor} · LP date ${range} · ${lineSubtitle(sel, generatedAt)}`,
    headers: [...LINE_HEADERS],
    rows: sel.map(lineRow),
  };
}

/* -------------------------- Entity sold reports ------------------------- */

const SALE_HEADERS = [
  "Sale Date", "Entity", "Salesman", "Invoice", "LP No", "Vendor", "Model", "Sold Qty", "Unit Price", "Value",
] as const;

function saleValue(s: SaleReportRow): number {
  return Number((s.soldQty * (s.unitPrice ?? 0)).toFixed(2));
}

/** Detail: one row per sale, filtered by entity + sale-date range. */
export function entitySoldDetail(
  sales: SaleReportRow[],
  generatedAt: string,
  entity: string,
  fromIso: string,
  toIso: string
): ReportTable {
  const range = `${fromIso || "…"} → ${toIso || "…"}`;
  const qty = sales.reduce((s, r) => s + r.soldQty, 0);
  const value = sales.reduce((s, r) => s + saleValue(r), 0);
  return {
    title: "LP Tracker — Entity Sold (detail)",
    subtitle: `${entity === "All" ? "All entities" : entity} · sale date ${range} · ${sales.length} sale${sales.length === 1 ? "" : "s"} · Qty ${qty.toLocaleString()} · Value AED ${fmt(value)} · generated ${generatedAt}`,
    headers: [...SALE_HEADERS],
    rows: sales.map((s) => [
      s.saleDate ?? "",
      entityLabel(s.entity, s.entityOther),
      s.salesmanName ?? "",
      s.invoiceNumber ?? "",
      s.lpNumber ?? "",
      s.vendorName ?? "",
      s.modelNo ?? s.sku ?? "",
      s.soldQty,
      s.unitPrice ?? "",
      saleValue(s),
    ]),
  };
}

/** Totals per entity: sale count, qty, value. */
export function entitySoldTotals(sales: SaleReportRow[]): ReportTable {
  const map = new Map<string, { count: number; qty: number; value: number }>();
  for (const s of sales) {
    const key = entityLabel(s.entity, s.entityOther);
    const agg = map.get(key) ?? { count: 0, qty: 0, value: 0 };
    agg.count += 1;
    agg.qty += s.soldQty;
    agg.value += saleValue(s);
    map.set(key, agg);
  }
  const rows: Cell[][] = [...map.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .map(([entity, a]) => [entity, a.count, a.qty, Number(a.value.toFixed(2))]);
  return {
    title: "Totals by Entity",
    headers: ["Entity", "Sales", "Sold Qty", "Value"],
    rows,
  };
}
