"use client";

import { useEffect, useState } from "react";

import { formatAED } from "@/lib/format";
import { fetchPipelineKpis, type PipelineKpis } from "@/lib/zohoPipelines";

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="group relative flex h-full min-h-[88px] flex-col justify-between overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/50 p-3 text-center shadow-sm ring-1 ring-inset ring-white/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-violet-900/50 dark:from-slate-900 dark:to-violet-950/20">
      <span className="absolute inset-y-0 left-0 w-1 bg-violet-400/80 transition-all group-hover:w-1.5 group-hover:bg-violet-500 dark:bg-violet-700" />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700/90 dark:text-violet-400/90">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

function PipelineCard({ p }: { p: PipelineKpis }) {
  const winRate = p.totalCount > 0 ? Math.round((p.wonCount / p.totalCount) * 100) : 0;
  return (
    <div className="rounded-2xl border border-violet-100 bg-white/60 p-3 dark:border-violet-900/50 dark:bg-slate-900/30">
      <p className="mb-2 text-sm font-semibold text-violet-800 dark:text-violet-300">{p.pipeline}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label="Open Deals" value={String(p.openCount)} />
        <Tile label="Open Value" value={formatAED(p.openValue)} tone="text-violet-700 dark:text-violet-400" />
        <Tile label="Won" value={String(p.wonCount)} tone="text-emerald-700 dark:text-emerald-400" />
        <Tile label="Won Value" value={formatAED(p.wonValue)} tone="text-emerald-700 dark:text-emerald-400" />
        <Tile label="Win Rate" value={`${winRate}%`} />
      </div>
    </div>
  );
}

export function ZohoPipelineBand() {
  const [pipelines, setPipelines] = useState<PipelineKpis[] | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await fetchPipelineKpis();
      if (!active) return;
      setConnected(r.configured);
      setPipelines(r.pipelines);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Hide entirely if Zoho isn't connected or returned nothing useful.
  if (connected === false) return null;

  return (
    <section className="mt-8 rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-white p-5 shadow-sm dark:border-violet-900/60 dark:from-violet-950/30 dark:via-slate-900 dark:to-slate-900">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight text-violet-800 dark:text-violet-300">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.2)]" />
        ZOHO CRM PIPELINES
        <span className="rounded-full bg-gradient-to-r from-violet-600 to-violet-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">Live</span>
      </h2>
      {pipelines === null ? (
        <p className="text-sm text-slate-500">Loading pipelines…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {pipelines.map((p) => (
            <PipelineCard key={p.pipeline} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}
