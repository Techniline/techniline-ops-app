"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { useAuth } from "@/app/providers/AuthProvider";
import { surface } from "@/components/ui";
import { isManager } from "@/lib/permissions";
import { fetchScorecard, type Kpi, type Scorecard } from "@/lib/scorecard";

const STATUS: Record<Kpi["status"], { dot: string; text: string; bar: string; ring: string }> = {
  good: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", ring: "border-l-emerald-500" },
  warn: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", ring: "border-l-amber-500" },
  bad: { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500", ring: "border-l-rose-500" },
  none: { dot: "bg-slate-400", text: "text-slate-900 dark:text-slate-100", bar: "bg-slate-400", ring: "border-l-slate-300 dark:border-l-slate-700" },
};

function KpiCard({ k }: { k: Kpi }) {
  const s = STATUS[k.status];
  return (
    <div className={`${surface} flex flex-col border-l-4 ${s.ring} p-4`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">{k.icon}</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{k.label}</span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${k.type === "leading" ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"}`}>
          {k.type}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold tabular-nums ${s.text}`}>{k.display}</span>
        {k.target ? (
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} /> target {k.target}
          </span>
        ) : null}
      </div>
      {k.sub ? <p className="mt-0.5 text-xs text-slate-500">{k.sub}</p> : null}

      {k.progress != null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${Math.max(2, Math.min(100, k.progress))}%` }} />
        </div>
      ) : null}

      <details className="group mt-3 text-xs">
        <summary className="cursor-pointer list-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <span className="underline decoration-dotted underline-offset-2">How it's calculated</span>
        </summary>
        <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2.5 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
          <p>{k.how}</p>
          <p className="text-[11px] text-slate-400">Source: {k.source}</p>
        </div>
      </details>
    </div>
  );
}

function Person({ name, role, accent, kpis }: { name: string; role: string; accent: string; kpis: Kpi[] }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${accent}`}>
          {name.slice(0, 1)}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{name}</h2>
          <p className="text-xs text-slate-500">{role}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => <KpiCard key={k.key} k={k} />)}
      </div>
    </section>
  );
}

function ScorecardContent() {
  const { profile } = useAuth();
  const [data, setData] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchScorecard().then((d) => { if (alive) { setData(d); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  if (!isManager(profile)) {
    return (
      <div>
        <PageHeader title="KPI Scorecard" />
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>This scorecard is available to managers.</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="KPI Scorecard" subtitle={data ? data.period : "Performance KPIs — leading drivers + lagging outcomes."} />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="rounded-full bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">leading</span> daily driver</span>
        <span className="flex items-center gap-1"><span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">lagging</span> outcome</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> on target</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> close</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> below</span>
      </div>

      {loading || !data ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading KPIs…</div>
      ) : (
        <>
          <Person name="Aaron" role="Orders · Reseller deliveries · Customer chats" accent="bg-indigo-500" kpis={data.aaron} />
          <Person name="Maricel" role="Returns documentation · Remittance recovery" accent="bg-teal-500" kpis={data.maricel} />
        </>
      )}
    </div>
  );
}

export default function ScorecardPage() {
  return (
    <RouteGuard>
      <AppShell>
        <ScorecardContent />
      </AppShell>
    </RouteGuard>
  );
}
