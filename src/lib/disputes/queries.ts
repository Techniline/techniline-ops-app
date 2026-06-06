import { supabase } from "@/lib/supabaseClient";

import type { Dispute, DisputeItem } from "./types";

/**
 * Fetch all disputes, most recently created first. Read-only.
 */
export async function fetchDisputes(): Promise<Dispute[]> {
  const { data, error } = await supabase
    .from("disputes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch the related items for a dispute. Items link to the parent by the
 * `dispute_number` string (there is no FK on `disputes.id`), so callers pass
 * the dispute's `dispute_number`. Read-only.
 */
export async function fetchDisputeItems(
  disputeNumber: string
): Promise<DisputeItem[]> {
  const { data, error } = await supabase
    .from("dispute_items")
    .select("*")
    .eq("dispute_number", disputeNumber)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}
