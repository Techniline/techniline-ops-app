"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, btnSmall, inputClass, surface } from "@/components/ui";
import { isManager } from "@/lib/permissions";
import {
  addBlocker,
  blockerAgeingDays,
  blockerAgeingTier,
  fetchBlockers,
  reopenBlocker,
  resolveBlocker,
  type AgeingTone,
  type Blocker,
} from "@/lib/blockers";
import { formatDate } from "@/lib/format";
import type { UserProfile } from "@/lib/types";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

const AGEING_STYLES: Record<AgeingTone, string> = {
  safe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  monitor: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  action: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function AgeingBadge({ days }: { days: number }) {
  const tier = blockerAgeingTier(days);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${AGEING_STYLES[tier]}`}>
      {days === 0 ? "today" : `${days}d`}
    </span>
  );
}

function BlockersContent({ profile }: { profile: UserProfile }) {
  const manager = isManager(profile);
  const [rows, setRows] = useState<Blocker[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [allUsers, setAllUsers] = useState(manager); // managers default to everyone's
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [what, setWhat] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchBlockers({ includeResolved, allUsers: manager && allUsers });
    setRows(data);
    setLoading(false);
  }, [includeResolved, allUsers, manager]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    if (what.trim() === "") return setErr("Describe what's blocking you.");
    setSaving(true);
    try {
      await addBlocker(what.trim(), note.trim() || null, profile.id);
      setShowAdd(false);
      setWhat("");
      setNote("");
      await load();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setSaving(false);
    }
  }

  async function resolve(id: string): Promise<void> {
    setBusyId(id);
    setErr(null);
    try {
      await resolveBlocker(id, profile.id);
      await load();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusyId(null);
    }
  }

  async function reopen(id: string): Promise<void> {
    setBusyId(id);
    setErr(null);
    try {
      await reopenBlocker(id);
      await load();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusyId(null);
    }
  }

  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <div>
      <PageHeader
        title="Blockers"
        subtitle="Raise anything blocking you (or a small to-do). Resolve it to clear it from the list."
        actions={
          <button type="button" onClick={() => setShowAdd(true)} className={btnPrimary}>
            + Add blocker
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {openCount} open
        </span>
        {manager ? (
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={allUsers} onChange={(e) => setAllUsers(e.target.checked)} />
            Everyone&apos;s
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>
          Nothing blocking you right now. 🎉
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((b) => {
            const resolved = b.status === "resolved";
            const days = blockerAgeingDays(b);
            return (
              <li
                key={b.id}
                className={`${surface} flex flex-wrap items-start gap-3 p-4 ${resolved ? "opacity-60" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{b.what}</p>
                  {b.note ? <p className="mt-0.5 text-sm text-slate-500">{b.note}</p> : null}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {manager && allUsers && b.owner_name ? `${b.owner_name} · ` : ""}
                    raised {formatDate(b.ageing_from)}
                    {resolved && b.resolved_at ? ` · resolved ${formatDate(b.resolved_at)}` : ""}
                  </p>
                </div>
                {!resolved ? <AgeingBadge days={days} /> : null}
                {resolved ? (
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => reopen(b.id)}
                    className={btnSmall}
                  >
                    Reopen
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => resolve(b.id)}
                    className={btnSmall}
                  >
                    {busyId === b.id ? "…" : "Resolve"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showAdd ? (
        <Modal title="Add a blocker" onClose={() => setShowAdd(false)}>
          <form onSubmit={save}>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              What&apos;s blocking you?
            </label>
            <input
              className={inputClass}
              placeholder="e.g. Waiting on supplier confirmation for PO 2600074"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              autoFocus
            />
            <label className="mb-1 mt-3 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Note (optional)
            </label>
            <textarea
              className={`${inputClass} min-h-[80px]`}
              placeholder="Any detail / who you're waiting on"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? "Saving…" : "Add blocker"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

export default function BlockersPage() {
  const { profile } = useAuth();
  return (
    <RouteGuard>
      <AppShell>{profile ? <BlockersContent profile={profile} /> : null}</AppShell>
    </RouteGuard>
  );
}
