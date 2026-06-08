import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

/** A computed row from `lp_items_view` (line + order + ageing + draw-down). */
export type LpItemRow = Tables<"lp_items_view">;

/** Which lifecycle slice to load. */
export type LpStatusFilter = "open" | "cleared" | "all";

export interface LpWindowOpts {
  status?: LpStatusFilter; // default 'open' (stock still in hand)
  vendor?: string; // exact vendor_name; "All"/undefined = no filter
  fromIso?: string; // lp_date >=
  toIso?: string; // lp_date <=
  limit?: number; // page size (default 100)
  offset?: number; // page offset (default 0)
}

/**
 * Server-side windowed fetch from `lp_items_view`. Instead of loading the whole
 * table, callers bound it by lifecycle (`open` = remaining > 0), vendor, and an
 * LP-date range, with `limit`/`offset` paging. Oldest LP first so the most-aged
 * stock surfaces at the top of the working list.
 */
export async function fetchLpItemsWindow(opts: LpWindowOpts = {}): Promise<LpItemRow[]> {
  const { status = "open", vendor, fromIso, toIso, limit = 100, offset = 0 } = opts;
  let q = supabase.from("lp_items_view").select("*");
  if (status === "open") q = q.gt("qty_remaining", 0);
  else if (status === "cleared") q = q.lte("qty_remaining", 0);
  if (vendor && vendor !== "All") q = q.eq("vendor_name", vendor);
  if (fromIso) q = q.gte("lp_date", fromIso);
  if (toIso) q = q.lte("lp_date", toIso);
  const { data, error } = await q
    .order("lp_date", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data ?? [];
}

/** Distinct vendor names (for the report vendor dropdown), alphabetical. */
export async function fetchVendors(): Promise<string[]> {
  const { data, error } = await supabase
    .from("lp_orders")
    .select("vendor_name")
    .order("vendor_name", { ascending: true });
  if (error) throw error;
  const set = new Set<string>();
  for (const r of data ?? []) if (r.vendor_name) set.add(r.vendor_name);
  return [...set];
}

/** One sale joined with its LP-line + order context (for the entity report). */
export interface SaleReportRow {
  saleDate: string | null;
  entity: string | null;
  entityOther: string | null;
  salesmanName: string | null;
  invoiceNumber: string | null;
  soldQty: number;
  modelNo: string | null;
  sku: string | null;
  lpNumber: string | null;
  vendorName: string | null;
  unitPrice: number | null;
}

/** Shape of the nested select result (lp_sales → lp_items → lp_orders). */
interface RawSaleJoin {
  sale_date: string | null;
  entity: string | null;
  entity_other: string | null;
  salesman_name: string | null;
  invoice_number: string | null;
  sold_qty: number;
  lp_items: {
    model_no: string | null;
    sku: string | null;
    unit_price: number | null;
    lp_orders: { lp_number: string | null; vendor_name: string | null } | null;
  } | null;
}

/**
 * Fetch sales in a sale-date range, joined to their LP line + order, for the
 * entity-wise sold report. Newest first.
 */
export async function fetchSalesReport(fromIso: string, toIso: string): Promise<SaleReportRow[]> {
  let query = supabase
    .from("lp_sales")
    .select(
      "sale_date, entity, entity_other, salesman_name, invoice_number, sold_qty, lp_items(model_no, sku, unit_price, lp_orders(lp_number, vendor_name))"
    );
  if (fromIso) query = query.gte("sale_date", fromIso);
  if (toIso) query = query.lte("sale_date", toIso);
  const { data, error } = await query.order("sale_date", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawSaleJoin[];
  return rows.map((r) => ({
    saleDate: r.sale_date,
    entity: r.entity,
    entityOther: r.entity_other,
    salesmanName: r.salesman_name,
    invoiceNumber: r.invoice_number,
    soldQty: r.sold_qty,
    modelNo: r.lp_items?.model_no ?? null,
    sku: r.lp_items?.sku ?? null,
    unitPrice: r.lp_items?.unit_price ?? null,
    lpNumber: r.lp_items?.lp_orders?.lp_number ?? null,
    vendorName: r.lp_items?.lp_orders?.vendor_name ?? null,
  }));
}

/** A flagged price movement for one LP line vs the same SKU's previous LP. */
export interface PriceAlert {
  previousPrice: number;
  currentPrice: number;
  delta: number; // current - previous
  pct: number; // signed percentage change
  direction: "up" | "down";
  previousLpNumber: string | null;
}

/**
 * Detect price changes per SKU across LPs. For each line, compares its unit
 * price to the most recent *earlier* LP carrying the same SKU and flags ANY
 * difference (up or down). Returns a map keyed by the view row id.
 */
export function computePriceAlerts(rows: LpItemRow[]): Map<string, PriceAlert> {
  const alerts = new Map<string, PriceAlert>();

  // Group rows by SKU (fallback to model_no), each ordered oldest LP first.
  const groups = new Map<string, LpItemRow[]>();
  for (const r of rows) {
    const key = (r.sku ?? r.model_no ?? "").trim().toUpperCase();
    if (key === "") continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) =>
      (a.lp_date ?? "").localeCompare(b.lp_date ?? "")
    );
    let prev: LpItemRow | null = null;
    for (const r of ordered) {
      const price = r.unit_price;
      const prevPrice = prev?.unit_price ?? null;
      if (
        r.id &&
        price != null &&
        prevPrice != null &&
        prevPrice !== 0 &&
        price !== prevPrice
      ) {
        const delta = price - prevPrice;
        alerts.set(r.id, {
          previousPrice: prevPrice,
          currentPrice: price,
          delta,
          pct: (delta / prevPrice) * 100,
          direction: delta > 0 ? "up" : "down",
          previousLpNumber: prev?.lp_number ?? null,
        });
      }
      // Only advance the baseline when this row has a usable price.
      if (price != null) prev = r;
    }
  }

  return alerts;
}
