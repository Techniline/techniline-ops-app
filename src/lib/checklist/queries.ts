import { supabase } from "@/lib/supabaseClient";
import { scopeToUser } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

import type {
  DailyTask,
  DailyTaskWithDefinition,
  TaskDefinition,
  TaskStatus,
} from "./types";

/**
 * Trigger server-side generation of today's standing daily tasks via the
 * `generate_daily_tasks` RPC (no args, returns void). Idempotent on the server.
 */
export async function generateDailyTasks(): Promise<void> {
  const { error } = await supabase.rpc("generate_daily_tasks");
  if (error) throw error;
}

/**
 * Fetch task definitions. Defaults to active definitions only.
 */
export async function fetchTaskDefinitions(
  options: { activeOnly?: boolean } = {}
): Promise<TaskDefinition[]> {
  const { activeOnly = true } = options;

  let query = supabase.from("task_definitions").select("*");
  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.order("title", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch raw daily tasks for a given date (YYYY-MM-DD), scoped to what the
 * given profile may read: managers see every user's tasks, everyone else only
 * their own (via `assigned_to`).
 */
export async function fetchDailyTasks(args: {
  date: string;
  profile: UserProfile | null;
}): Promise<DailyTask[]> {
  const { date, profile } = args;

  const scoped = scopeToUser(
    supabase.from("daily_tasks").select("*").eq("task_date", date),
    profile
  );

  const { data, error } = await scoped.order("created_at", {
    ascending: true,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch the checklist for a date: daily tasks joined to their definitions,
 * scoped to what the given profile may read.
 */
export async function fetchChecklistForDate(args: {
  date: string;
  profile: UserProfile | null;
}): Promise<DailyTaskWithDefinition[]> {
  const { date, profile } = args;

  const scoped = scopeToUser(
    supabase
      .from("daily_tasks")
      .select("*, task_definitions(*)")
      .eq("task_date", date),
    profile
  );

  const { data, error } = await scoped.order("created_at", {
    ascending: true,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Count breach_log rows on/after `sinceDate` (YYYY-MM-DD), scoped by RLS
 * (own for staff, all for managers). Fail-soft: returns 0 on error.
 */
export async function fetchBreachCountSince(sinceDate: string): Promise<number> {
  const { count, error } = await supabase
    .from("breach_log")
    .select("id", { count: "exact", head: true })
    .gte("breach_date", sinceDate);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Update a single daily task's status. Returns the updated row.
 */
export async function setDailyTaskStatus(args: {
  id: string;
  status: TaskStatus;
}): Promise<DailyTask> {
  const { id, status } = args;

  const { data, error } = await supabase
    .from("daily_tasks")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
