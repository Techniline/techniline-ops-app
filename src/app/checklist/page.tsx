"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, btnSmall, inputClass, surface } from "@/components/ui";
import {
  fetchChecklistForDate,
  fetchSubmissionsForTasks,
  generateDailyTasks,
  submitTaskWithEvidence,
  type DailyTaskWithDefinition,
  type Submission,
  type TaskEvidence,
  type TaskStatus,
} from "@/lib/checklist";
import { canViewUser, isManager } from "@/lib/permissions";
import {
  completePriority,
  createPriority,
  fetchAssignableUsers,
  fetchPriorities,
  priorityState,
  updatePriorityProgress,
  type AssignableUser,
  type Priority,
} from "@/lib/priorities";
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

/* --------------------------- evidence inputs --------------------------- */

const chipClass =
  "inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300";

interface TaskCardProps {
  task: DailyTaskWithDefinition;
  profile: UserProfile;
  isManagerView: boolean;
  submitting: boolean;
  submittedLine?: string | null;
  onSubmit: (taskId: string, evidence: TaskEvidence) => void;
}

function TaskCard({
  task,
  profile,
  isManagerView,
  submitting,
  submittedLine,
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
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            <StatusBadge status={task.status} />
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
                <dd className="truncate font-mono text-xs">
                  {task.assigned_to ?? "unassigned"}
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

/* ------------------------------ Priorities ----------------------------- */

const PRIORITY_STATE_STYLES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  open: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function PriorityStateBadge({ p }: { p: Priority }) {
  const s = priorityState(p);
  const label = s === "in_progress" ? "In progress" : s === "completed" ? "Completed" : "Open";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STATE_STYLES[s]}`}>
      {label}
    </span>
  );
}

function CreatePriorityModal({
  profile,
  managerView,
  users,
  onClose,
  onSaved,
}: {
  profile: UserProfile;
  managerView: boolean;
  users: AssignableUser[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const today = todayISODate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<string>(managerView ? "both" : profile.id);
  const [startDate, setStartDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErr(null);
    if (title.trim() === "") return setErr("Title is required.");
    if (dueDate < startDate) return setErr("Due date can't be before the start date.");
    setSaving(true);
    try {
      await createPriority({
        createdBy: profile.id,
        title: title.trim(),
        description: description.trim() || null,
        assignedTo: assignee === "both" ? null : assignee,
        assignedToBoth: assignee === "both",
        startDate,
        dueDate,
      });
      onSaved("Priority created.");
    } catch (e) {
      setErr(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Priority" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Title *</span>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Description</span>
          <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {managerView ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Assign to</span>
            <select className={inputClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="both">Both users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60">
            This priority will be assigned to you.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Start date</span>
            <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Due date</span>
            <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
        {err ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PriorityCard({
  p,
  users,
  canEdit,
  onChanged,
  onError,
}: {
  p: Priority;
  users: AssignableUser[];
  canEdit: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const completed = priorityState(p) === "completed";
  const [pct, setPct] = useState(String(p.progress_pct ?? 0));
  const [busy, setBusy] = useState(false);
  const assignee = p.assigned_to_both
    ? "Both users"
    : users.find((u) => u.id === p.assigned_to)?.name ?? "—";
  const due = p.due_date_revised ?? p.due_date;
  const overdue = !completed && due ? due < todayISODate() : false;

  async function saveProgress(): Promise<void> {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return onError("Progress must be 0–100.");
    setBusy(true);
    try {
      await updatePriorityProgress(p.id, Math.round(n));
      onChanged("Progress updated.");
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function complete(): Promise<void> {
    const note = window.prompt("Completion note (optional):", "") ?? null;
    setBusy(true);
    try {
      await completePriority(p.id, note && note.trim() !== "" ? note.trim() : null);
      onChanged("Priority completed.");
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const progress = p.progress_pct ?? 0;
  return (
    <li className={`${surface} p-4 ${completed ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">{p.title}</h3>
            <PriorityStateBadge p={p} />
            {overdue ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Overdue</span>
            ) : null}
          </div>
          {p.description ? <p className="mt-1 text-sm text-slate-500">{p.description}</p> : null}
          <p className="mt-1 text-xs text-slate-400">
            {assignee} · due {due ?? "—"}
            {p.due_date_revised ? " (revised)" : ""}
            {completed && p.completion_note ? ` · ${p.completion_note}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="w-10 text-right text-xs font-medium text-slate-500">{progress}%</span>
      </div>

      {canEdit && !completed ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="0"
            max="100"
            step="5"
            className={`${inputClass} w-24`}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />
          <button type="button" onClick={() => void saveProgress()} disabled={busy} className={btnSmall}>
            Save progress
          </button>
          <button type="button" onClick={() => void complete()} disabled={busy} className={btnSecondary}>
            Mark complete
          </button>
        </div>
      ) : null}
    </li>
  );
}

function PrioritiesPanel({
  priorities,
  users,
  profile,
  managerView,
  onAdd,
  onChanged,
  onError,
}: {
  priorities: Priority[];
  users: AssignableUser[];
  profile: UserProfile;
  managerView: boolean;
  onAdd: () => void;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const sorted = useMemo(() => {
    const rank = (p: Priority) => (priorityState(p) === "completed" ? 1 : 0);
    return [...priorities].sort(
      (a, b) => rank(a) - rank(b) || (a.due_date_revised ?? a.due_date).localeCompare(b.due_date_revised ?? b.due_date)
    );
  }, [priorities]);

  function canEdit(p: Priority): boolean {
    return managerView || p.created_by === profile.id || p.assigned_to === profile.id || p.assigned_to_both === true;
  }

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Priorities
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            {priorities.filter((p) => priorityState(p) !== "completed").length}
          </span>
        </h2>
        <button type="button" onClick={onAdd} className={btnSmall}>+ Add priority</button>
      </div>
      {sorted.length === 0 ? (
        <div className={`${surface} p-6 text-center text-sm text-slate-500`}>
          No priorities yet. {managerView ? "Add one and assign it to a user (or both)." : "Add a priority for yourself, or your manager can assign one."}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((p) => (
            <PriorityCard key={p.id} p={p} users={users} canEdit={canEdit(p)} onChanged={onChanged} onError={onError} />
          ))}
        </ul>
      )}
    </section>
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

function ChecklistContent() {
  const { profile } = useAuth();

  const [tasks, setTasks] = useState<DailyTaskWithDefinition[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [showAddPriority, setShowAddPriority] = useState(false);

  const profileId = profile?.id ?? null;

  const reloadPriorities = useCallback(async () => {
    if (!profile) return;
    setPriorities(await fetchPriorities(profile));
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Priorities, assignable users, and the work-log submissions are all
    // fail-soft (empty until the RLS policies in CHECKLIST-PRIORITIES-SETUP.md
    // are applied) — they never block the checklist itself.
    const [prio, userList, subs] = await Promise.all([
      fetchPriorities(profile),
      fetchAssignableUsers(),
      fetchSubmissionsForTasks(taskRows.map((t) => t.id)),
    ]);
    setPriorities(prio);
    setUsers(userList);
    setSubmissions(subs);

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
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name);
    if (profile) m.set(profile.id, profile.full_name ?? profile.email ?? "You");
    return m;
  }, [users, profile]);

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

  function handlePriorityChanged(message: string) {
    setActionError(null);
    setBanner(message);
    void reloadPriorities();
  }

  return (
    <div>
      <PageHeader title="Today's Checklist" subtitle={todayLabel()} />

      {banner ? (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
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
      ) : (
        <>
          <PrioritiesPanel
            priorities={priorities}
            users={users}
            profile={profile}
            managerView={managerView}
            onAdd={() => { setBanner(null); setShowAddPriority(true); }}
            onChanged={handlePriorityChanged}
            onError={(m) => setActionError(m)}
          />

          <section className="mb-2">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Today&apos;s Tasks
            </h2>
            {error ? (
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
                <ul className="flex flex-col gap-3">
                  {tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      profile={profile}
                      isManagerView={managerView}
                      submitting={submittingId === task.id}
                      submittedLine={submittedLineFor(task.id)}
                      onSubmit={handleSubmit}
                    />
                  ))}
                </ul>
              </>
            )}
          </section>

          <WorkLogPanel
            submissions={submissions}
            taskTitleById={taskTitleById}
            userNameById={userNameById}
          />
        </>
      )}

      {showAddPriority ? (
        <CreatePriorityModal
          profile={profile}
          managerView={managerView}
          users={users}
          onClose={() => setShowAddPriority(false)}
          onSaved={(m) => { setShowAddPriority(false); handlePriorityChanged(m); }}
        />
      ) : null}
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
