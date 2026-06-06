import type { Tables, TablesInsert, TablesUpdate } from "@/lib/types";

/** A row from the computed ageing view (`ageing_days`, `ageing_status`, ...). */
export type CocobluAgeingRow = Tables<"cocoblu_ageing_view">;

/** A row in the underlying `cocoblu_ageing` table (insert/update target). */
export type CocobluRecord = Tables<"cocoblu_ageing">;

/** Full insert/update shapes for `cocoblu_ageing`, from generated types. */
export type CocobluAgeingInsert = TablesInsert<"cocoblu_ageing">;
export type CocobluAgeingUpdate = TablesUpdate<"cocoblu_ageing">;

/**
 * The only columns callers may supply when creating a record. Derived from the
 * generated insert type so it stays in sync with the schema. Server-managed
 * columns (id, created_at, updated_at, status) and computed columns
 * (ageing_days, ageing_status) are intentionally excluded.
 */
export type CocobluCreateInput = Pick<
  CocobluAgeingInsert,
  | "invoice_number"
  | "invoice_date"
  | "supplied_date"
  | "sku"
  | "qty_supplied"
  | "qty_remaining"
  | "unit_cost"
  | "notes"
>;

/** Arguments for {@link updateCocobluQty}. */
export interface UpdateCocobluQtyInput {
  id: string;
  qtySupplied: number;
  newQtyRemaining: number;
  notes?: string | null;
}

/** Aggregated figures for the Cocoblu ageing summary. */
export interface CocobluSummary {
  totalOpenRecords: number;
  over90Records: number;
  warningRecords: number;
  totalQtyRemaining: number;
  qty90Plus: number;
  qty76To89: number;
  qty61To75: number;
}
