import { hasCapability, isManager } from "@/lib/permissions";
import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert, TablesUpdate, UserProfile } from "@/lib/types";

export interface AssignableUser {
  id: string;
  name: string;
}

/** Users who hold the `checklist` capability — the valid assignees for a
 *  priority. Fail-soft: returns [] on error (e.g. before a users read policy). */
export async function fetchAssignableUsers(): Promise<AssignableUser[]> {
  const { data, error } = await supabase.from("users").select("id, full_name, email");
  if (error) return [];
  return (data ?? [])
    .filter((u) => hasCapability({ id: u.id } as unknown as UserProfile, "checklist"))
    .map((u) => ({ id: u.id, name: u.full_name ?? u.email ?? u.id }));
}

/** A row in the `priorities` table (manager/user-assigned objectives). */
export type Priority = Tables<"priorities">;

export interface CreatePriorityInput {
  createdBy: string;
  title: string;
  description: string | null;
  /** A specific user id, or null when `assignedToBoth` is true. */
  assignedTo: string | null;
  assignedToBoth: boolean;
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
}

/**
 * Fetch priorities the profile may see. RLS is the real gate; we also scope the
 * query for non-managers (own / assigned / assigned-to-both). Fail-soft: returns
 * [] on error (e.g. before RLS policies are applied) so the page never breaks.
 */
export async function fetchPriorities(profile: UserProfile): Promise<Priority[]> {
  let query = supabase.from("priorities").select("*");
  if (!isManager(profile)) {
    query = query.or(
      `assigned_to.eq.${profile.id},assigned_to_both.is.true,created_by.eq.${profile.id}`
    );
  }
  const { data, error } = await query.order("due_date", { ascending: true });
  if (error) return [];
  return data ?? [];
}

/** Create a priority. `status` is left to the DB default; completion is tracked
 *  via `completed_at`/`progress_pct` (avoids assuming the status CHECK values). */
export async function createPriority(input: CreatePriorityInput): Promise<void> {
  const payload: TablesInsert<"priorities"> = {
    created_by: input.createdBy,
    title: input.title,
    description: input.description,
    assigned_to: input.assignedToBoth ? null : input.assignedTo,
    assigned_to_both: input.assignedToBoth,
    start_date: input.startDate,
    due_date: input.dueDate,
  };
  const { error } = await supabase.from("priorities").insert(payload);
  if (error) throw new Error(error.message);
}

/** Update progress (0–100) and optionally a revised due date. */
export async function updatePriorityProgress(
  id: string,
  progressPct: number,
  dueDateRevised?: string | null
): Promise<void> {
  const payload: TablesUpdate<"priorities"> = { progress_pct: progressPct };
  if (dueDateRevised !== undefined) payload.due_date_revised = dueDateRevised;
  const { data, error } = await supabase
    .from("priorities")
    .update(payload)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Update affected no rows.");
}

/** Mark a priority complete (sets completed_at, progress 100, optional note). */
export async function completePriority(
  id: string,
  completionNote: string | null
): Promise<void> {
  const payload: TablesUpdate<"priorities"> = {
    completed_at: new Date().toISOString(),
    progress_pct: 100,
    completion_note: completionNote,
  };
  const { data, error } = await supabase
    .from("priorities")
    .update(payload)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Update affected no rows.");
}

/** Derived display status (the stored `status` enum is backend-owned). */
export function priorityState(p: Priority): "completed" | "in_progress" | "open" {
  if (p.completed_at) return "completed";
  if ((p.progress_pct ?? 0) > 0) return "in_progress";
  return "open";
}
