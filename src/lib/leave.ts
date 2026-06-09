import { isManager } from "@/lib/permissions";
import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert, UserProfile } from "@/lib/types";

/** A staff leave entry (a date range a user is away — no tasks generate then). */
export type LeaveRow = Tables<"staff_leave">;

export interface AddLeaveInput {
  userId: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  reason: string | null;
  createdBy: string;
}

/** Leave entries the profile may see (own for staff, all for managers). */
export async function fetchLeave(profile: UserProfile): Promise<LeaveRow[]> {
  let q = supabase.from("staff_leave").select("*");
  if (!isManager(profile)) q = q.eq("user_id", profile.id);
  const { data, error } = await q.order("from_date", { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Record a leave range. RLS enforces self-or-manager. */
export async function addLeave(input: AddLeaveInput): Promise<void> {
  if (input.fromDate === "" || input.toDate === "") {
    throw new Error("From and To dates are required.");
  }
  if (input.toDate < input.fromDate) {
    throw new Error("End date can't be before start date.");
  }
  const payload: TablesInsert<"staff_leave"> = {
    user_id: input.userId,
    from_date: input.fromDate,
    to_date: input.toDate,
    reason: input.reason,
    created_by: input.createdBy,
  };
  const { error } = await supabase.from("staff_leave").insert(payload);
  if (error) throw new Error(error.message);
}

/** Remove a leave entry. */
export async function deleteLeave(id: string): Promise<void> {
  const { error } = await supabase.from("staff_leave").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
