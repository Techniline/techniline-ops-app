import { supabase } from "@/lib/supabaseClient";

import type { ReturnRow } from "./types";

/**
 * Fetch all returns, most recently received first. Read-only.
 */
export async function fetchReturns(): Promise<ReturnRow[]> {
  const { data, error } = await supabase
    .from("returns")
    .select("*")
    .order("date_received", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
