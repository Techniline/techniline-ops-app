"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, surface } from "@/components/ui";
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

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Phase 1: only `submitted` counts as done (no verification workflow yet). */
const DONE_STATUSES: ReadonlySet<string> = new Set<TaskStatus>(["submitted"]);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  verified:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  breached: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] ??
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}
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

function TaskCard({
  task,
  profile,
  isManagerView,
  submitting,
  onSubmit,
}: TaskRowProps) {
  const definition = task.task_definitions;
  const title = definition?.title ?? "Untitled task";

  const canAct = task.assigned_to
    ? canViewUser(profile, task.assigned_to)
    : isManager(profile);
  const canSubmit = task.status === "open" && canAct;

  return (
    <li className={`${surface} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            <StatusBadge status={task.status} />
          </div>

          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-500 sm:grid-cols-2">
            <div className="flex gap-1">
              <dt className="font-medium text-slate-600 dark:text-slate-400">
                Evidence:
              </dt>
              <dd>{definition?.evidence_type ?? "—"}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium text-slate-600 dark:text-slate-400">
                Source:
              </dt>
              <dd>{task.source}</dd>
            </div>
            {definition?.evidence_hint ? (
              <div className="flex gap-1 sm:col-span-2">
                <dt className="font-medium text-slate-600 dark:text-slate-400">
                  Hint:
                </dt>
                <dd>{definition.evidence_hint}</dd>
              </div>
            ) : null}
            <div className="flex gap-1">
              <dt className="font-medium text-slate-600 dark:text-slate-400">
                Created:
              </dt>
              <dd>{formatCreatedAt(task.created_at)}</dd>
            </div>
            {isManagerView ? (
              <div className="flex gap-1">
                <dt className="font-medium text-slate-600 dark:text-slate-400">
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
          className={`${btnPrimary} shrink-0`}
        >
          {submitting ? "Submitting…" : "Mark as Submitted"}
        </button>
      </div>
    </li>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className={`${surface} mb-6 p-4`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-300">
          Completion
        </span>
        <span className="text-slate-500">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {done}
          </span>{" "}
          / {total} done · {pct}%
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
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

  return (
    <div>
      <PageHeader title="Today's Checklist" subtitle={todayLabel()} />

      {actionError ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>
          Loading checklist…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className={`${btnSecondary} mt-3`}
          >
            Retry
          </button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">
            No tasks found for today. Contact your administrator.
          </p>
        </div>
      ) : (
        <>
          <ProgressBar done={done} total={total} />
          <ul className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                profile={profile}
                isManagerView={managerView}
                submitting={submittingId === task.id}
                onSubmit={handleSubmit}
              />
            ))}
          </ul>
        </>
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
