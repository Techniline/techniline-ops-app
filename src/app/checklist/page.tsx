"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { RouteGuard } from "@/components/RouteGuard";
import {
  fetchChecklistForDate,
  generateDailyTasks,
  setDailyTaskStatus,
  type DailyTaskWithDefinition,
  type TaskStatus,
} from "@/lib/checklist";
import { canViewUser, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

/** Local-time today as YYYY-MM-DD (matches `daily_tasks.task_date`). */
function todayISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Statuses that count as "done" toward completion. */
const DONE_STATUSES: ReadonlySet<string> = new Set<TaskStatus>([
  "submitted",
  "verified",
]);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  verified: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  breached: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] ??
    "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status}
    </span>
  );
}

function formatCreatedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

interface TaskRowProps {
  task: DailyTaskWithDefinition;
  profile: UserProfile;
  isManagerView: boolean;
  submitting: boolean;
  onSubmit: (taskId: string) => void;
}

function TaskRow({
  task,
  profile,
  isManagerView,
  submitting,
  onSubmit,
}: TaskRowProps) {
  const definition = task.task_definitions;
  const title = definition?.title ?? "Untitled task";

  // Staff may only act on their own tasks; managers may act on any.
  const canAct = task.assigned_to
    ? canViewUser(profile, task.assigned_to)
    : isManager(profile);
  const canSubmit = task.status === "open" && canAct;

  return (
    <li className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900 dark:text-gray-100">
              {title}
            </h3>
            <StatusBadge status={task.status} />
          </div>

          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-gray-500 sm:grid-cols-2">
            <div className="flex gap-1">
              <dt className="font-medium text-gray-600 dark:text-gray-400">
                Evidence:
              </dt>
              <dd>{definition?.evidence_type ?? "—"}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium text-gray-600 dark:text-gray-400">
                Source:
              </dt>
              <dd>{task.source}</dd>
            </div>
            {definition?.evidence_hint ? (
              <div className="flex gap-1 sm:col-span-2">
                <dt className="font-medium text-gray-600 dark:text-gray-400">
                  Hint:
                </dt>
                <dd>{definition.evidence_hint}</dd>
              </div>
            ) : null}
            <div className="flex gap-1">
              <dt className="font-medium text-gray-600 dark:text-gray-400">
                Created:
              </dt>
              <dd>{formatCreatedAt(task.created_at)}</dd>
            </div>
            {isManagerView ? (
              <div className="flex gap-1">
                <dt className="font-medium text-gray-600 dark:text-gray-400">
                  Assigned to:
                </dt>
                <dd className="truncate font-mono text-xs">
                  {task.assigned_to ?? "unassigned"}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <button
          type="button"
          onClick={() => onSubmit(task.id)}
          disabled={!canSubmit || submitting}
          className="shrink-0 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
        >
          {submitting ? "Submitting…" : "Mark as Submitted"}
        </button>
      </div>
    </li>
  );
}

function ChecklistContent() {
  const { profile } = useAuth();

  const [tasks, setTasks] = useState<DailyTaskWithDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const profileId = profile?.id ?? null;

  const load = useCallback(async () => {
    if (!profile) return;

    setLoading(true);
    setError(null);
    setActionError(null);

    // Generating today's standing tasks is best-effort; never block the view.
    try {
      await generateDailyTasks();
    } catch (rpcError) {
      console.warn("generateDailyTasks failed; continuing.", rpcError);
    }

    try {
      const data = await fetchChecklistForDate({
        date: todayISODate(),
        profile,
      });
      setTasks(data);
    } catch (fetchError) {
      setError(errorMessage(fetchError));
    } finally {
      setLoading(false);
    }
    // `profile` is intentionally tracked via its id to avoid identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(taskId: string) {
    setSubmittingId(taskId);
    setActionError(null);
    try {
      await setDailyTaskStatus({ id: taskId, status: "submitted" });
      await load();
    } catch (updateError) {
      setActionError(errorMessage(updateError));
    } finally {
      setSubmittingId(null);
    }
  }

  if (!profile) return null;

  const managerView = isManager(profile);
  const total = tasks.length;
  const done = tasks.filter((task) => DONE_STATUSES.has(task.status)).length;
  const completion = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Today&apos;s Checklist
        </h1>
        {!loading && !error ? (
          <div className="text-sm text-gray-500">
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {done}
            </span>{" "}
            / {total} done
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {completion}%
            </span>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading checklist…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
          >
            Retry
          </button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm text-gray-500">
            No tasks found for today. Contact your administrator.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              profile={profile}
              isManagerView={managerView}
              submitting={submittingId === task.id}
              onSubmit={handleSubmit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ChecklistPage() {
  return (
    <RouteGuard requireCapability="checklist">
      <AppShell>
        <ChecklistContent />
      </AppShell>
    </RouteGuard>
  );
}
