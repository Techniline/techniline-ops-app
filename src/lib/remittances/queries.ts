import { supabase } from "@/lib/supabaseClient";

import type { Remittance, RemittanceLine } from "./types";

/**
 * Fetch all remittances, most recent payment first. Read-only.
 */
export async function fetchRemittances(): Promise<Remittance[]> {
  const { data, error } = await supabase
    .from("remittances")
    .select("*")
    .order("payment_date", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch the line items for a remittance. Lines link to the parent by the
 * `remittance_ref` string (there is no FK on `remittances.id`), so callers pass
 * the remittance's `remittance_ref`. Read-only.
 */
export async function fetchRemittanceDetails(
  remittanceRef: string
): Promise<RemittanceLine[]> {
  const { data, error } = await supabase
    .from("remittance_lines")
    .select("*")
    .eq("remittance_ref", remittanceRef)
    .order("invoice_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}
