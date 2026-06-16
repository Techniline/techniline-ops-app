"use client";

import { useEffect, useState } from "react";

import { surface } from "@/components/ui";
import { fetchWazzupStats, type WazzupStats } from "@/lib/wazzup";

/** Dashboard "Chats" card — pending/unanswered chats, oldest waiting time, new
 *  today, and % replied within 15 min (team-wide, from Wazzup). Refreshes on
 *  mount and every 2 minutes. */
export function WazzupCard() {
  const [s, setS] = useState<WazzupStats | null>(null);

  useEffect(() => {
    let alive = true;
    const run = () => fetchWazzupStats().then((r) => { if (alive) setS(r); });
    void run();
    const id = setInterval(run, 120_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const tile = (label: string, value: string, tone: string, sub?: string) => (
    <div className="rounded-xl bg-white/70 p-3 dark:bg-slate-900/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
    </div>
  );

  const pendingTone = (s?.pendingChats ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100";
  const waitTone = (s?.oldestWaitingMin ?? 0) > 15 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100";
  const pctTone = s?.repliedPct == null ? "text-slate-400" : s.repliedPct >= 90 ? "text-emerald-600 dark:text-emerald-400" : s.repliedPct >= 70 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  return (
    <section className={`${surface} mt-6 p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" /> Chats (WhatsApp / Wazzup)
        </h2>
        <a href="https://crm.zoho.com" target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">Open Wazzup →</a>
      </div>
      {s === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tile("Pending chats", String(s.pendingChats), pendingTone, "awaiting reply")}
          {tile("Oldest waiting", s.oldestWaitingMin ? `${s.oldestWaitingMin}m` : "—", waitTone, s.oldestWaitingMin > 15 ? "over 15 min" : "within SLA")}
          {tile("New today", String(s.newToday), "text-slate-900 dark:text-slate-100", "chats")}
          {tile("Replied <15 min", s.repliedPct == null ? "—" : `${s.repliedPct}%`, pctTone, s.repliedTotal ? `of ${s.repliedTotal} (7d)` : "no data yet")}
        </div>
      )}
    </section>
  );
}
