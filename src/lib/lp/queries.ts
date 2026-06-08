import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

/** A computed row from `lp_items_view` (line + order + ageing + draw-down). */
export type LpItemRow = Tables<"lp_items_view">;

/** Fetch all LP line items from the ageing view, oldest LP first. */
export async function fetchLpItems(): Promise<LpItemRow[]> {
  const { data, error } = await supabase
    .from("lp_items_view")
    .select("*")
    .order("lp_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Master search across LP number, vendor, SKU and model. Empty query returns
 * everything (same as {@link fetchLpItems}).
 */
export async function searchLp(q: string): Promise<LpItemRow[]> {
  const term = q.trim();
  if (term === "") return fetchLpItems();
  const safe = term.replace(/[%,]/g, " ");
  const { data, error } = await supabase
    .from("lp_items_view")
    .select("*")
    .or(
      `lp_number.ilike.%${safe}%,vendor_name.ilike.%${safe}%,sku.ilike.%${safe}%,model_no.ilike.%${safe}%`
    )
    .order("lp_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
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
