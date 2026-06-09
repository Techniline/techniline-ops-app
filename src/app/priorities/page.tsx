"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, btnSmall, inputClass, surface } from "@/components/ui";
import { WeeklySummaryModal } from "@/components/WeeklySummaryModal";
import { isManager } from "@/lib/permissions";
import {
  createPriority,
  fetchAssignableUsers,
  fetchPriorities,
  fetchUserDirectory,
  priorityDisplayStatus,
  sendNotification,
  updatePriority,
  type AssignableUser,
  type Priority,
  type PriorityDisplayStatus,
  type PriorityLevel,
} from "@/lib/priorities";
import type { UserProfile } from "@/lib/types";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/* ------------------------------- badges -------------------------------- */

const LEVEL_STYLES: Record<string, string> = {
  P1: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  P2: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  P3: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};
function LevelBadge({ level }: { level: string | null }) {
  const l = level ?? "P2";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLES[l] ?? LEVEL_STYLES.P2}`}>
      {l}
    </span>
  );
}

const STATUS_STYLES: Record<PriorityDisplayStatus, string> = {
  open: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
const STATUS_LABEL: Record<PriorityDisplayStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  overdue: "Overdue",
  completed: "Completed",
};
function StatusBadge({ s }: { s: PriorityDisplayStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s]}`}>{STATUS_LABEL[s]}</span>;
}

/* --------------------------- new priority ------------------------------ */

function NewPriorityModal({
  profile,
  users,
  onClose,
  onSaved,
}: {
  profile: UserProfile;
  users: AssignableUser[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const managerView = isManager(profile);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<string>(managerView ? (users[0]?.id ?? "both") : profile.id);
  const [level, setLevel] = useState<PriorityLevel>("P2");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErr(null);
    if (title.trim() === "") return setErr("Title is required.");
    if (dueDate === "") return setErr("Due date is required.");

    setSaving(true);
    try {
      const both = managerView && assignee === "both";
      const created = await createPriority({
        createdBy: profile.id,
        title: title.trim(),
        description: description.trim() || null,
        assignedTo: both ? null : managerView ? assignee : profile.id,
        assignedToBoth: both,
        dueDate,
        priorityLevel: level,
        notes: notes.trim() || null,
      });

      // Managers notify the assignee(s) via the manager-gated email route.
      // Self-created priorities are the user's own — no notification.
      let warn = "";
      if (managerView) {
        const recipients = both
          ? users.map((u) => u.email).filter(Boolean)
          : [users.find((u) => u.id === assignee)?.email].filter((x): x is string => !!x);
        if (recipients.length > 0) {
          const subject = `New Priority assigned: ${created.title} (${level})`;
          const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
            <h2 style="margin:0 0 8px">New Priority assigned</h2>
            <p><b>${created.title}</b> &nbsp;<span style="color:#666">[${level}]</span></p>
            ${created.description ? `<p>${created.description}</p>` : ""}
            <p><b>Due:</b> ${dueDate}</p>
            <p style="color:#666">Assigned by ${profile.full_name ?? profile.email ?? "your manager"}.</p>
          </div>`;
          const r = await sendNotification(recipients, subject, html);
          if (!r.ok) warn = ` (⚠ email notification failed: ${r.error})`;
        } else {
          warn = " (no email on file for the assignee)";
        }
      }
      onSaved(`Priority created.${warn}`);
    } catch (e) {
      setErr(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Modal title="New Priority" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Title *</span>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Description</span>
          <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Assign to</span>
            {managerView ? (
              <select className={inputClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ""}</option>
                ))}
                <option value="both">Both</option>
              </select>
            ) : (
              <input
                className={inputClass}
                value={`${profile.full_name ?? profile.email ?? "You"} (you)`}
                readOnly
                disabled
              />
            )}
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Priority</span>
            <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value as PriorityLevel)}>
              <option value="P1">P1 — urgent</option>
              <option value="P2">P2 — normal</option>
              <option value="P3">P3 — low</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Due date *</span>
            <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Notes</span>
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {err ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Create & notify"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------- priority card --------------------------- */

function PriorityCard({
  p,
  assigneeName,
  canEdit,
  onChanged,
  onError,
}: {
  p: Priority;
  assigneeName: string;
  canEdit: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const status = priorityDisplayStatus(p);
  const completed = status === "completed";
  const [pct, setPct] = useState(String(p.progress_pct ?? 0));
  const [note, setNote] = useState(p.notes ?? "");
  const [busy, setBusy] = useState(false);
  const due = p.due_date_revised ?? p.due_date;

  async function run(fn: () => Promise<void>, msg: string): Promise<void> {
    setBusy(true);
    try {
      await fn();
      onChanged(msg);
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
            <LevelBadge level={p.priority_level} />
            <h3 className="font-medium text-slate-900 dark:text-slate-100">{p.title}</h3>
            <StatusBadge s={status} />
          </div>
          {p.description ? <p className="mt-1 text-sm text-slate-500">{p.description}</p> : null}
          <p className="mt-1 text-xs text-slate-400">
            {p.assigned_to_both ? "Both users" : assigneeName} · due {due ?? "—"}
            {p.due_date_revised ? " (revised)" : ""}
          </p>
          {p.notes ? <p className="mt-1 text-xs text-slate-500">📝 {p.notes}</p> : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="w-10 text-right text-xs font-medium text-slate-500">{progress}%</span>
      </div>

      {canEdit && !completed ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
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
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const n = Number(pct);
                if (!Number.isFinite(n) || n < 0 || n > 100) return onError("Progress must be 0–100.");
                void run(() => updatePriority(p.id, { progressPct: n, status: n > 0 ? "in_progress" : undefined }), "Progress updated.");
              }}
              className={btnSmall}
            >
              Save progress
            </button>
            {status === "open" ? (
              <button type="button" disabled={busy} onClick={() => void run(() => updatePriority(p.id, { status: "in_progress" }), "Marked in progress.")} className={btnSmall}>
                Mark in progress
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => void run(() => updatePriority(p.id, { status: "completed" }), "Priority completed.")} className={btnSecondary}>
              Mark complete
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputClass} flex-1`} placeholder="Add a progress note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" disabled={busy} onClick={() => void run(() => updatePriority(p.id, { notes: note.trim() || null }), "Note saved.")} className={btnSmall}>
              Save note
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------- content ------------------------------- */

function PrioritiesContent() {
  const { profile } = useAuth();
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [directory, setDirectory] = useState<Map<string, AssignableUser>>(new Map());
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showWeekly, setShowWeekly] = useState(false);

  const profileId = profile?.id ?? null;

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const [prio, assignable, dir] = await Promise.all([
      fetchPriorities(profile),
      fetchAssignableUsers(),
      fetchUserDirectory(),
    ]);
    setPriorities(prio);
    setUsers(assignable);
    setDirectory(dir);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const rank = (p: Priority) => (priorityDisplayStatus(p) === "completed" ? 2 : priorityDisplayStatus(p) === "overdue" ? 0 : 1);
    return [...priorities].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.priority_level ?? "P2").localeCompare(b.priority_level ?? "P2") ||
        (a.due_date_revised ?? a.due_date).localeCompare(b.due_date_revised ?? b.due_date)
    );
  }, [priorities]);

  if (!profile) return null;
  const managerView = isManager(profile);

  function canEdit(p: Priority): boolean {
    return managerView || p.created_by === profile!.id || p.assigned_to === profile!.id || p.assigned_to_both === true;
  }
  function nameFor(p: Priority): string {
    if (!p.assigned_to) return "—";
    return directory.get(p.assigned_to)?.name ?? "—";
  }
  function changed(msg: string) {
    setActionError(null);
    setBanner(msg);
    void load();
  }

  return (
    <div>
      <PageHeader
        title="Priorities"
        subtitle={managerView ? "Assign and track priorities across the team." : "Your priorities — assigned to you, plus ones you add."}
        actions={
          <div className="flex flex-wrap gap-2">
            {managerView ? (
              <button type="button" onClick={() => setShowWeekly(true)} className={btnSecondary}>Send weekly summary</button>
            ) : null}
            <button type="button" onClick={() => { setBanner(null); setShowNew(true); }} className={btnPrimary}>+ New Priority</button>
          </div>
        }
      />

      {banner ? (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{actionError}</p>
      ) : null}

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading priorities…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">
            {managerView ? "No priorities yet. Create one and assign it." : "No priorities yet. Add your own with “+ New Priority”."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((p) => (
            <PriorityCard
              key={p.id}
              p={p}
              assigneeName={nameFor(p)}
              canEdit={canEdit(p)}
              onChanged={changed}
              onError={(m) => setActionError(m)}
            />
          ))}
        </ul>
      )}

      {showNew ? (
        <NewPriorityModal
          profile={profile}
          users={users}
          onClose={() => setShowNew(false)}
          onSaved={(m) => { setShowNew(false); changed(m); }}
        />
      ) : null}

      {showWeekly ? (
        <WeeklySummaryModal
          profile={profile}
          onClose={() => setShowWeekly(false)}
          onSent={(m) => { setShowWeekly(false); setBanner(m); }}
        />
      ) : null}
    </div>
  );
}

export default function PrioritiesPage() {
  return (
    <RouteGuard>
      <AppShell>
        <PrioritiesContent />
      </AppShell>
    </RouteGuard>
  );
}
