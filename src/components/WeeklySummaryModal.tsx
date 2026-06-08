"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { fetchAssignableUsers, sendNotification } from "@/lib/priorities";
import {
  buildWeeklySummary,
  renderWeeklySummaryHtml,
  type WeeklySummary,
} from "@/lib/priorities/weekly";
import type { UserProfile } from "@/lib/types";

/**
 * Manager weekly-summary preview + "email to me". Self-contained — fetches the
 * staff list and builds the live summary itself, so it can be dropped on any
 * page (Priorities, Dashboard). Email send is fail-soft via /api/priorities/notify.
 */
export function WeeklySummaryModal({
  profile,
  onClose,
  onSent,
}: {
  profile: UserProfile;
  onClose: () => void;
  onSent?: (message: string) => void;
}) {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const staff = await fetchAssignableUsers();
      const s = await buildWeeklySummary(profile, staff);
      if (active) setSummary(s);
    })();
    return () => {
      active = false;
    };
  }, [profile]);

  async function send(): Promise<void> {
    if (!summary) return;
    const email = profile.email;
    if (!email) {
      setErr("No email on your profile to send to.");
      return;
    }
    setSending(true);
    setErr(null);
    const r = await sendNotification(
      [email],
      `Weekly Operations Summary — ${summary.date}`,
      renderWeeklySummaryHtml(summary)
    );
    setSending(false);
    if (r.ok) {
      setSent(`Emailed to ${email}.`);
      onSent?.(`Weekly summary emailed to ${email}.`);
    } else {
      setErr(`Send failed: ${r.error}`);
    }
  }

  return (
    <Modal title="Weekly Summary" onClose={onClose} wide>
      {!summary ? (
        <p className="text-sm text-slate-500">Computing…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">User</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Tasks today</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Priorities done</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Open</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {summary.users.map((u) => (
                  <tr key={u.userId} className="border-t border-slate-100 dark:border-slate-800/60">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{u.name}</td>
                    <td className="px-3 py-2">{u.tasksDone}/{u.tasksTotal}</td>
                    <td className="px-3 py-2">{u.prioritiesCompleted}</td>
                    <td className="px-3 py-2">{u.prioritiesOpen}</td>
                    <td className={`px-3 py-2 ${u.prioritiesOverdue > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{u.prioritiesOverdue}</td>
                  </tr>
                ))}
                {summary.users.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">No staff data available.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {summary.cocoblu ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Cocoblu (Aaron):</span> {summary.cocoblu.openRecords} open · {summary.cocoblu.qtyRemaining} qty · {summary.cocoblu.over90} aged 90+
            </p>
          ) : null}
          {summary.amazon ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium">Amazon Actions (Maricel):</span> {summary.amazon.openActions} open · {summary.amazon.missingDocs} missing docs · {summary.amazon.overdue} overdue
            </p>
          ) : null}
          {sent ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{sent}</p>
          ) : null}
          {err ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
            <button type="button" onClick={() => void send()} disabled={sending || !!sent} className={btnPrimary}>
              {sending ? "Sending…" : "Email to me"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
