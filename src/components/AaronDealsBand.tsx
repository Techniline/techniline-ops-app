"use client";

import { useEffect, useState } from "react";

import { formatAED } from "@/lib/format";
import { supabase } from "@/lib/supabaseClient";

interface NeedsActionDeal {
  id: string;
  name: string | null;
  stage: string | null;
  amount: number | null;
  pipeline: string;
  createdTime: string | null;
  url: string;
}

function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const d = Math.max(0, Math.floor(ms / 86_400_000));
  return d === 0 ? "today" : `${d}d ago`;
}

/** Aaron's focused list: his open deals with no activity/task yet (need a next action). */
export function AaronDealsBand() {
  const [deals, setDeals] = useState<NeedsActionDeal[] | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch("/api/zoho/my-deals", { headers: { Authorization: `Bearer ${token}` } });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; configured?: boolean; deals?: NeedsActionDeal[] };
      if (!active) return;
      setConnected(!!j.configured);
      setDeals(j.deals ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (connected === false) return null;

  return (
    <section className="mt-8 rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-white p-5 shadow-sm dark:border-violet-900/60 dark:from-violet-950/30 dark:via-slate-900 dark:to-slate-900">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold tracking-tight text-violet-800 dark:text-violet-300">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.2)]" />
        MY DEALS — NEED ACTION
        {deals ? (
          <span className="rounded-full bg-gradient-to-r from-violet-600 to-violet-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
            {deals.length}
          </span>
        ) : null}
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Deals you created that still have no activity or task — open each in Zoho and log the next step.
      </p>

      {deals === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : deals.length === 0 ? (
        <div className="rounded-2xl border border-violet-100 bg-white/70 p-6 text-center text-sm text-slate-500 dark:border-violet-900/50 dark:bg-slate-900/30">
          All your deals have a next action. 🎉
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {deals.map((d) => (
            <li
              key={d.id}
              className="group flex flex-wrap items-center gap-3 rounded-2xl border border-violet-100 bg-white/70 p-3 shadow-sm ring-1 ring-inset ring-white/60 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-violet-900/50 dark:bg-slate-900/30"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900 dark:text-slate-100">{d.name ?? "(untitled deal)"}</p>
                <p className="truncate text-[11px] text-slate-400">
                  {d.pipeline} · {d.stage ?? "—"}
                  {d.createdTime ? ` · created ${daysAgo(d.createdTime)}` : ""}
                </p>
              </div>
              {d.amount != null ? (
                <span className="text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-400">{formatAED(d.amount)}</span>
              ) : null}
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-violet-300 bg-gradient-to-b from-white to-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(15,23,42,0.08)] transition-all hover:to-violet-100 active:translate-y-px dark:border-violet-700 dark:from-slate-800 dark:to-violet-950/40 dark:text-violet-300"
              >
                Open in CRM →
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
