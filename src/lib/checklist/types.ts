import type { Tables } from "@/lib/types";

/**
 * Allowed `daily_tasks.status` values. Mirrors the DB CHECK constraint
 * `daily_tasks_status_check` — keep in sync if the constraint changes.
 */
export const TASK_STATUSES = [
  "open",
  "submitted",
  "verified",
  "breached",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Allowed `daily_tasks.source` values. Mirrors the DB CHECK constraint
 * `daily_tasks_source_check`.
 */
export const TASK_SOURCES = ["standing", "email_triggered"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Raw row types, sourced from the generated database types. */
export type DailyTask = Tables<"daily_tasks">;
export type TaskDefinition = Tables<"task_definitions">;

/**
 * A daily task joined to its originating definition (via the
 * `daily_tasks.task_def_id -> task_definitions.id` FK). The relation is
 * nullable because `task_def_id` is nullable.
 */
export type DailyTaskWithDefinition = DailyTask & {
  task_definitions: TaskDefinition | null;
};

/** Narrow an arbitrary string to a known TaskStatus (DB-enforced values). */
export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}
