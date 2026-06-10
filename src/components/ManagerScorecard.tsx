"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Modal } from "@/components/Modal";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { formatAED } from "@/lib/format";
import {
  buildManagerScorecard,
  managerSummaryTables,
  renderManagerSummaryHtml,
  type ManagerScorecard as Scorecard,
} from "@/lib/manager/summary";
import { MONTHLY_SUMMARY_RECIPIENT_KEY, getSetting, setSetting } from "@/lib/settings";
import { supabase } from "@/lib/supabaseClient";
import type { UserProfile } from "@/lib/types";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

export function ManagerScorecard({ profile }: { profile: UserProfile }) {
  const [s, setS] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [card, saved] = await Promise.all([
      buildManagerScorecard(),
      getSetting(MONTHLY_SUMMARY_RECIPIENT_KEY),
    ]);
    setS(card);
    if (saved) setRecipient(saved);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function send(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBanner(null);
    const to = recipient.trim();
    if (!to.includes("@")) return setErr("Enter a valid recipient email.");
    if (!s) return;
    setSending(true);
    try {
      // Persist the recipient as the editable default.
      await setSetting(MONTHLY_SUMMARY_RECIPIENT_KEY, to, profile.id).catch(() => {});
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in.");
      const res = await fetch("/api/manager/send-summary", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: `Techniline — Monthly Operations Summary (${s.monthLabel})`,
          html: renderManagerSummaryHtml(s),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setShowSend(false);
      setBanner(`Monthly summary sent to ${to}.`);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border-2 border-violet-300 bg-violet-50/60 p-4 dark:border-violet-800 dark:bg-violet-950/20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-violet-800 dark:text-violet-300">
          MANAGER SCORECARD
          <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
            {s?.monthLabel ?? "this month"}
          </span>
        </h2>
        <button type="button" onClick={() => setShowSend(true)} className={btnPrimary}>
          Send monthly summary
        </button>
      </div>

      {banner ? <p className="mb-2 text-xs text-violet-700 dark:text-violet-300">{banner}</p> : null}

      {loading || !s ? (
        <p className="text-sm text-slate-500">Loading scorecard…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <Tile
            label="MM Target Attainment"
            value={s.mmPct != null ? `${s.mmPct}%` : "—"}
            tone={s.mmPct != null && s.mmPct >= 100 ? "text-emerald-700 dark:text-emerald-400" : undefined}
          />
          <Tile label="MM Recovery Rate" value={s.mmRecoveryRate != null ? `${s.mmRecoveryRate}%` : "—"} />
          <Tile
            label="Cocoblu 90+ (storage risk)"
            value={`${s.cocobluStorageRiskCount} · ${formatAED(s.cocobluStorageRiskValue)}`}
            tone={s.cocobluStorageRiskCount > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}
          />
          <Tile
            label="LP Aged 90+"
            value={`${s.lpAged90Count} · ${formatAED(s.lpAged90Value)}`}
            tone={s.lpAged90Count > 0 ? "text-amber-700 dark:text-amber-400" : undefined}
          />
          <Tile
            label="Amazon Open Actions"
            value={String(s.amazonOpen)}
            tone={s.amazonOpen > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}
          />
          <Tile
            label="Open Blockers"
            value={s.openBlockers ? `${s.openBlockers} (${s.oldestBlockerDays}d)` : "0"}
            tone={s.openBlockers > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}
          />
          <Tile
            label="Checklist Breaches (mo)"
            value={String(s.checklistBreachesThisMonth)}
            tone={s.checklistBreachesThisMonth > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}
          />
        </div>
      )}

      {showSend && s ? (
        <Modal title="Send monthly summary" onClose={() => setShowSend(false)} wide>
          <form onSubmit={send}>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Recipient (Sales Head)
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              placeholder="e.g. amrit@techniline.org"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">Saved as the default for next month (editable each time).</p>

            <div className="mt-4 max-h-[45vh] overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              {managerSummaryTables(s).map((t) => (
                <div key={t.title} className="mb-4 last:mb-0">
                  <p className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{t.title}</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {t.rows.map((r, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                          <td className="py-1 pr-4 text-slate-600 dark:text-slate-400">{String(r[0])}</td>
                          <td className="py-1 text-right font-medium text-slate-900 dark:text-slate-100">{String(r[1])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowSend(false)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" disabled={sending} className={btnPrimary}>
                {sending ? "Sending…" : "Send email"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
