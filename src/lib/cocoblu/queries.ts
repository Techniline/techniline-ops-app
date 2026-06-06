import { supabase } from "@/lib/supabaseClient";

import type {
  CocobluAgeingInsert,
  CocobluAgeingRow,
  CocobluAgeingUpdate,
  CocobluCreateInput,
  CocobluRecord,
  UpdateCocobluQtyInput,
} from "./types";

/**
 * Fetch all rows from the ageing view, ordered by invoice date ascending.
 */
export async function fetchCocobluAgeing(): Promise<CocobluAgeingRow[]> {
  const { data, error } = await supabase
    .from("cocoblu_ageing_view")
    .select("*")
    .order("invoice_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Create a `cocoblu_ageing` record. Only the caller-supplied business columns
 * are inserted; id / timestamps / status / computed columns are left to the DB.
 */
export async function createCocobluRecord(
  input: CocobluCreateInput
): Promise<CocobluRecord> {
  const payload: CocobluAgeingInsert = {
    invoice_number: input.invoice_number,
    invoice_date: input.invoice_date,
    supplied_date: input.supplied_date ?? null,
    sku: input.sku,
    qty_supplied: input.qty_supplied,
    qty_remaining: input.qty_remaining,
    unit_cost: input.unit_cost ?? null,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase
    .from("cocoblu_ageing")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  if (!data) throw new Error("Failed to create Cocoblu record.");
  return data;
}

/**
 * Update the remaining quantity (and notes) for a record. Validates the new
 * quantity, sets `updated_at`, and closes the record when it reaches zero.
 *
 * Treats both a DB error and a zero-row result as failure — never reports
 * success when nothing was updated.
 */
export async function updateCocobluQty(
  input: UpdateCocobluQtyInput
): Promise<CocobluRecord> {
  const { id, qtySupplied, newQtyRemaining, notes } = input;

  // Validate defensively against runtime values (e.g. parsed form input),
  // using `unknown` so the checks stay meaningful and free of `any`.
  const candidate: unknown = newQtyRemaining;
  if (candidate === undefined || candidate === null || candidate === "") {
    throw new Error("New quantity is required.");
  }
  if (typeof candidate !== "number" || Number.isNaN(candidate)) {
    throw new Error("New quantity must be a number.");
  }
  if (candidate < 0) {
    throw new Error("New quantity cannot be negative.");
  }
  if (candidate > qtySupplied) {
    throw new Error("New quantity cannot exceed quantity supplied.");
  }

  const payload: CocobluAgeingUpdate = {
    qty_remaining: candidate,
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) {
    payload.notes = notes;
  }
  if (candidate === 0) {
    payload.status = "closed";
  }

  const { data, error } = await supabase
    .from("cocoblu_ageing")
    .update(payload)
    .eq("id", id)
    .select("*");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Update affected no rows.");
  }
  return data[0];
}
