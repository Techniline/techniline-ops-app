"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import {
  fetchChecklistForDate,
  fetchSubmissionsForTasks,
  fetchUserNames,
  generateDailyTasks,
  submitTaskWithEvidence,
  type DailyTaskWithDefinition,
  type Submission,
  type TaskEvidence,
  type TaskStatus,
} from "@/lib/checklist";
import { addLeave, deleteLeave, fetchLeave, type LeaveRow } from "@/lib/leave";
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

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CadenceBadge({ cadence, weekday }: { cadence: string | null; weekday: number | null }) {
  const c = cadence ?? "daily";
  if (c === "weekly") {
    const wd = weekday != null && weekday >= 0 && weekday <= 6 ? ` · ${WEEKDAY[weekday]}` : "";
    return (
      <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Weekly{wd}
      </span>
    );
  }
  if (c === "adhoc") {
    return (
      <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        As needed
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
      Daily
    </span>
  );
}

function formatCreatedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

/* --------------------------- evidence inputs --------------------------- */

const chipClass =
  "inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300";

interface TaskCardProps {
  task: DailyTaskWithDefinition;
  profile: UserProfile;
  isManagerView: boolean;
  submitting: boolean;
  submittedLine?: string | null;
  assignedToName?: string | null;
  onSubmit: (taskId: string, evidence: TaskEvidence) => void;
}

function TaskCard({
  task,
  profile,
  isManagerView,
  submitting,
  submittedLine,
  assignedToName,
  onSubmit,
}: TaskCardProps) {
  const definition = task.task_definitions;
  const title = definition?.title ?? "Untitled task";
  const evType = definition?.evidence_type ?? "text";
  const hint = definition?.evidence_hint ?? "";

  const canAct = task.assigned_to
    ? canViewUser(profile, task.assigned_to)
    : isManager(profile);

  // Per-type evidence input state.
  const [text, setText] = useState("");
  const [count, setCount] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [chipInput, setChipInput] = useState("");

  // Map evidence_type to a concrete input. Unknown types fall back to text.
  const inputKind: "text" | "count" | "id_list" =
    evType === "id_list" ? "id_list" : evType === "count" ? "count" : "text";

  const isOpen = task.status === "open";

  function addChip() {
    const value = chipInput.trim();
    if (!value) return;
    setChips((prev) => [...prev, value]);
    setChipInput("");
  }

  function removeChip(index: number) {
    setChips((prev) => prev.filter((_, i) => i !== index));
  }

  function onChipKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addChip();
    }
  }

  const countNum = Number(count);
  const countValid =
    count.trim() !== "" && Number.isFinite(countNum) && countNum >= 0;

  const hasProof =
    evType === "one_tap"
      ? true
      : inputKind === "id_list"
        ? chips.length > 0
        : inputKind === "count"
          ? countValid
          : text.trim() !== "";

  /** Build the evidence payload for a positive submission, or null if invalid. */
  function buildEvidence(): TaskEvidence | null {
    if (evType === "one_tap") {
      return {
        evidenceText: "Confirmed",
        evidenceCount: null,
        isNothingToAction: false,
        nothingToActionNote: null,
      };
    }
    if (evType === "id_list") {
      if (chips.length === 0) return null;
      return {
        evidenceText: chips.join(", "),
        evidenceCount: chips.length,
        isNothingToAction: false,
        nothingToActionNote: null,
      };
    }
    if (evType === "count") {
      if (!countValid) return null;
      return {
        evidenceText: `Count: ${countNum}`,
        evidenceCount: countNum,
        isNothingToAction: false,
        nothingToActionNote: null,
      };
    }
    // text + any unknown type → treat as free text
    const value = text.trim();
    if (value === "") return null;
    return {
      evidenceText: value,
      evidenceCount: null,
      isNothingToAction: false,
      nothingToActionNote: null,
    };
  }

  function handleSubmitProof() {
    const evidence = buildEvidence();
    if (!evidence) return;
    onSubmit(task.id, evidence);
  }

  function handleNothingToAction() {
    onSubmit(task.id, {
      evidenceText: null,
      evidenceCount: null,
      isNothingToAction: true,
      nothingToActionNote: hint || "Nothing to action today",
    });
  }

  return (
    <li className={`${surface} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            <StatusBadge status={task.status} />
            <CadenceBadge cadence={definition?.cadence ?? "daily"} weekday={definition?.weekday ?? null} />
          </div>
          {submittedLine ? (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">✓ {submittedLine}</p>
          ) : null}

          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-500 sm:grid-cols-2">
            <div className="flex gap-1">
              <dt className="font-medium text-slate-600 dark:text-slate-400">
                Evidence:
              </dt>
              <dd>{evType}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium text-slate-600 dark:text-slate-400">
                Source:
              </dt>
              <dd>{task.source}</dd>
            </div>
            {hint ? (
              <div className="flex gap-1 sm:col-span-2">
                <dt className="font-medium text-slate-600 dark:text-slate-400">
                  Hint:
                </dt>
                <dd>{hint}</dd>
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
                <dd className="truncate">
                  {assignedToName ?? (task.assigned_to ? "Unknown user" : "Unassigned")}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      {/* Evidence / submit area — only for open tasks the user may act on. */}
      {!isOpen ? null : !canAct ? (
        <p className="mt-3 text-xs text-slate-400">
          Assigned to another user — you can&apos;t submit this task.
        </p>
      ) : (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          {evType === "one_tap" ? (
            <button
              type="button"
              onClick={handleSubmitProof}
              disabled={submitting}
              className={btnPrimary}
            >
              {submitting ? "Confirming…" : "Confirm"}
            </button>
          ) : (
            <>
              {inputKind === "text" ? (
                <textarea
                  className={inputClass}
                  rows={2}
                  placeholder="Enter proof / notes…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              ) : null}

              {inputKind === "count" ? (
                <input
                  type="number"
                  min="0"
                  step="1"
                  onWheel={(e) => e.currentTarget.blur()}
                  className={`${inputClass} max-w-[160px]`}
                  placeholder="0"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              ) : null}

              {inputKind === "id_list" ? (
                <div>
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      placeholder="Enter an ID and press Enter…"
                      value={chipInput}
                      onChange={(e) => setChipInput(e.target.value)}
                      onKeyDown={onChipKeyDown}
                    />
                    <button
                      type="button"
                      onClick={addChip}
                      className={btnSecondary}
                    >
                      Add
                    </button>
                  </div>
                  {chips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {chips.map((chip, index) => (
                        <span key={`${chip}-${index}`} className={chipClass}>
                          {chip}
                          <button
                            type="button"
                            onClick={() => removeChip(index)}
                            className="text-indigo-500 hover:text-indigo-700"
                            aria-label={`Remove ${chip}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmitProof}
                  disabled={!hasProof || submitting}
                  className={btnPrimary}
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
                <button
                  type="button"
                  onClick={handleNothingToAction}
                  disabled={submitting}
                  className={btnSecondary}
                >
                  Nothing to action today
                </button>
              </div>
            </>
          )}
        </div>
      )}
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

/* ------------------------------ Work Log ------------------------------- */

function WorkLogPanel({
  submissions,
  taskTitleById,
  userNameById,
}: {
  submissions: Submission[];
  taskTitleById: Map<string, string>;
  userNameById: Map<string, string>;
}) {
  if (submissions.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Today&apos;s Work Log
      </h2>
      <div className={`${surface} divide-y divide-slate-100 dark:divide-slate-800/60`}>
        {submissions.map((s) => {
          const time = s.submitted_at ? new Date(s.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          const detail = s.is_nothing_to_action
            ? `Nothing to action${s.nothing_to_action_note ? ` — ${s.nothing_to_action_note}` : ""}`
            : s.evidence_text ?? (s.evidence_count != null ? `Count: ${s.evidence_count}` : "Submitted");
          return (
            <div key={s.id} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {taskTitleById.get(s.daily_task_id) ?? "Task"}
                </p>
                <p className="text-xs text-slate-500">{detail}</p>
              </div>
              <div className="shrink-0 text-right text-xs text-slate-400">
                <p>{userNameById.get(s.submitted_by) ?? ""}</p>
                <p>{time}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------- Leave --------------------------------- */

function LeaveModal({
  profile,
  managerView,
  userNames,
  onClose,
  onChanged,
}: {
  profile: UserProfile;
  managerView: boolean;
  userNames: Map<string, string>;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(profile.id);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setRows(await fetchLeave(profile));
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const userOptions = useMemo(
    () => [...userNames.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    [userNames]
  );

  async function add(): Promise<void> {
    setErr(null);
    setBusy(true);
    try {
      await addLeave({
        userId: managerView ? userId : profile.id,
        fromDate,
        toDate,
        reason: reason.trim() || null,
        createdBy: profile.id,
      });
      setFromDate(""); setToDate(""); setReason("");
      await reload();
      onChanged("Leave recorded — no tasks generate on those days.");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await deleteLeave(id);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="my-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6 dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Leave / absence</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        <p className="mb-4 text-xs text-slate-500">On leave days, no checklist is generated for that person — so absences aren&apos;t counted as missed work.</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {managerView ? (
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">Person</span>
              <select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
                {userOptions.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">From</span>
            <input type="date" className={inputClass} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">To</span>
            <input type="date" className={inputClass} value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-700 dark:text-slate-300">Reason (optional)</span>
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        {err ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p> : null}
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={busy} onClick={() => void add()} className={btnPrimary}>{busy ? "Saving…" : "Add leave"}</button>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recorded leave</p>
          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">None recorded.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                  <span className="text-slate-700 dark:text-slate-300">
                    {managerView ? `${userNames.get(r.user_id) ?? "User"} · ` : ""}{r.from_date} → {r.to_date}
                    {r.reason ? <span className="text-slate-400"> — {r.reason}</span> : null}
                  </span>
                  <button type="button" disabled={busy} onClick={() => void remove(r.id)} className="text-xs font-medium text-red-500 hover:text-red-700">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ChecklistContent() {
  const { profile } = useAuth();
  const [showLeave, setShowLeave] = useState(false);

  const [tasks, setTasks] = useState<DailyTaskWithDefinition[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
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

    let taskRows: DailyTaskWithDefinition[] = [];
    try {
      taskRows = await fetchChecklistForDate({ date: todayISODate(), profile });
      setTasks(taskRows);
    } catch (fetchError) {
      setError(errorMessage(fetchError));
    }

    // Work-log submissions + names are fail-soft (empty until the submissions
    // read policy is applied) — they never block the checklist itself.
    const [subs, names] = await Promise.all([
      fetchSubmissionsForTasks(taskRows.map((t) => t.id)),
      fetchUserNames(),
    ]);
    setSubmissions(subs);
    setUserNames(names);

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(taskId: string, evidence: TaskEvidence) {
    if (!profile) return;
    setSubmittingId(taskId);
    setActionError(null);
    try {
      await submitTaskWithEvidence({ taskId, submittedBy: profile.id, ...evidence });
      await load();
    } catch (submitError) {
      setActionError(errorMessage(submitError));
    } finally {
      setSubmittingId(null);
    }
  }

  const userNameById = useMemo(() => {
    const m = new Map<string, string>(userNames);
    if (profile) m.set(profile.id, profile.full_name ?? profile.email ?? "You");
    return m;
  }, [userNames, profile]);

  const taskTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) m.set(t.id, t.task_definitions?.title ?? "Task");
    return m;
  }, [tasks]);

  const lastSubmissionByTask = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of submissions) if (!m.has(s.daily_task_id)) m.set(s.daily_task_id, s);
    return m;
  }, [submissions]);

  // Group tasks under their definition's category, ordered by sort_order.
  const groupedTasks = useMemo(() => {
    const order = (t: DailyTaskWithDefinition) => t.task_definitions?.sort_order ?? 9999;
    const byCat = new Map<string, DailyTaskWithDefinition[]>();
    for (const t of tasks) {
      const cat = t.task_definitions?.category ?? "Other";
      const arr = byCat.get(cat);
      if (arr) arr.push(t);
      else byCat.set(cat, [t]);
    }
    return [...byCat.entries()]
      .map(([category, items]) => ({
        category,
        items: [...items].sort((a, b) => order(a) - order(b)),
        min: Math.min(...items.map(order)),
      }))
      .sort((a, b) => a.min - b.min);
  }, [tasks]);

  if (!profile) return null;

  const managerView = isManager(profile);
  const total = tasks.length;
  const done = tasks.filter((task) => DONE_STATUSES.has(task.status)).length;

  function submittedLineFor(taskId: string): string | null {
    const s = lastSubmissionByTask.get(taskId);
    if (!s) return null;
    const time = s.submitted_at
      ? new Date(s.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
    const who = userNameById.get(s.submitted_by) ?? "";
    const what = s.is_nothing_to_action
      ? "Nothing to action"
      : s.evidence_text ?? (s.evidence_count != null ? `Count: ${s.evidence_count}` : "Submitted");
    return `submitted ${time}${who ? ` by ${who}` : ""} — ${what}`;
  }

  return (
    <div>
      <PageHeader
        title="Today's Checklist"
        subtitle={todayLabel()}
        actions={
          <button type="button" onClick={() => setShowLeave(true)} className={btnSecondary}>
            Leave / absence
          </button>
        }
      />

      {showLeave ? (
        <LeaveModal
          profile={profile}
          managerView={managerView}
          userNames={userNameById}
          onClose={() => setShowLeave(false)}
          onChanged={() => { setShowLeave(false); setActionError(null); void load(); }}
        />
      ) : null}

      {actionError ? (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
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
          <button type="button" onClick={() => void load()} className={`${btnSecondary} mt-3`}>Retry</button>
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">No tasks found for today.</p>
        </div>
      ) : (
        <>
          <ProgressBar done={done} total={total} />
          <div className="flex flex-col gap-6">
            {groupedTasks.map((group) => (
              <section key={group.category}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.category}
                </h2>
                <ul className="flex flex-col gap-3">
                  {group.items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      profile={profile}
                      isManagerView={managerView}
                      submitting={submittingId === task.id}
                      submittedLine={submittedLineFor(task.id)}
                      assignedToName={
                        task.assigned_to ? userNameById.get(task.assigned_to) ?? null : null
                      }
                      onSubmit={handleSubmit}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <WorkLogPanel
            submissions={submissions}
            taskTitleById={taskTitleById}
            userNameById={userNameById}
          />
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
