"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { useAuth } from "@/app/providers/AuthProvider";
import { inputClass, surface } from "@/components/ui";
import { buildCycle, currentYearQuarter, fetchStoredCycle, friThuWeek, saveCycle } from "@/lib/kpiCycle";
import { isManager } from "@/lib/permissions";
import { fetchScorecard, type Kpi, type Scorecard } from "@/lib/scorecard";

/** Achievement-% colour band (matches the company KPI sheet):
 *  >120 blue · 100–119 green · 80–99 yellow · <80 red · no-target slate. */
type Band = { card: string; ring: string; chip: string; bar: string; value: string };
function bandFor(a: number | null): Band {
  if (a == null) return { card: "bg-white dark:bg-slate-900/40", ring: "border-l-slate-300 dark:border-l-slate-700", chip: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200", bar: "bg-slate-400", value: "text-slate-900 dark:text-slate-100" };
  if (a > 120) return { card: "bg-sky-50 dark:bg-sky-950/30", ring: "border-l-sky-500", chip: "bg-sky-500 text-white", bar: "bg-sky-500", value: "text-sky-700 dark:text-sky-300" };
  if (a >= 100) return { card: "bg-emerald-50 dark:bg-emerald-950/30", ring: "border-l-emerald-500", chip: "bg-emerald-500 text-white", bar: "bg-emerald-500", value: "text-emerald-700 dark:text-emerald-300" };
  if (a >= 80) return { card: "bg-amber-50 dark:bg-amber-950/30", ring: "border-l-amber-400", chip: "bg-amber-400 text-amber-950", bar: "bg-amber-400", value: "text-amber-700 dark:text-amber-300" };
  return { card: "bg-rose-50 dark:bg-rose-950/30", ring: "border-l-rose-500", chip: "bg-rose-500 text-white", bar: "bg-rose-500", value: "text-rose-700 dark:text-rose-300" };
}

function KpiCard({ k }: { k: Kpi }) {
  const b = bandFor(k.achievement);
  return (
    <div className={`flex flex-col rounded-xl border border-slate-200 border-l-4 ${b.ring} ${b.card} p-4 shadow-sm dark:border-slate-800`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">{k.icon}</span>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{k.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {k.achievement != null ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${b.chip}`}>{k.achievement}%</span>
          ) : null}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${k.type === "leading" ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"}`}>
            {k.type}
          </span>
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold tabular-nums ${b.value}`}>{k.display}</span>
        {k.target ? <span className="text-xs text-slate-400">target {k.target}</span> : null}
      </div>
      {k.sub ? <p className="mt-0.5 text-xs text-slate-500">{k.sub}</p> : null}

      {k.progress != null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
          <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${Math.max(2, Math.min(100, k.progress))}%` }} />
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

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";
const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

function ScorecardContent() {
  const { profile } = useAuth();
  const manager = isManager(profile);
  const canView = manager || profile?.id === AARON_ID || profile?.id === MARICEL_ID;

  const [data, setData] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const init = currentYearQuarter();
  const [year, setYear] = useState(init.year);
  const [quarter, setQuarter] = useState(init.quarter);
  const week = friThuWeek();

  // Load the shared cycle (set by a manager) from the DB on mount.
  useEffect(() => {
    let alive = true;
    fetchStoredCycle().then((c) => { if (alive) { setYear(c.year); setQuarter(c.quarter); } });
    return () => { alive = false; };
  }, []);

  // Recompute KPIs whenever the cycle changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchScorecard(buildCycle(year, quarter)).then((d) => { if (alive) { setData(d); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [year, quarter]);

  function changeCycle(y: number, q: number) {
    setYear(y); setQuarter(q);
    void saveCycle(y, q).catch(() => { /* non-manager can't save; ignored */ });
  }

  const cy = currentYearQuarter().year;
  const years = [cy - 1, cy, cy + 1];

  if (!canView) {
    return (
      <div>
        <PageHeader title="KPI Scorecard" />
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>You don't have access to the KPI scorecard.</div>
      </div>
    );
  }

  const showAaron = manager || profile?.id === AARON_ID;
  const showMaricel = manager || profile?.id === MARICEL_ID;

  return (
    <div>
      <PageHeader title="KPI Scorecard" subtitle={data ? data.period : "Performance KPIs — leading drivers + lagging outcomes."} />

      <div className={`${surface} mb-4 flex flex-wrap items-center gap-3 p-3`}>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cycle</span>
        {manager ? (
          <>
            <select value={quarter} onChange={(e) => changeCycle(year, Number(e.target.value))} className={`${inputClass} max-w-[110px]`}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
            <select value={year} onChange={(e) => changeCycle(Number(e.target.value), quarter)} className={`${inputClass} max-w-[110px]`}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        ) : (
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Q{quarter} {year}</span>
        )}
        <span className="text-xs text-slate-500">{buildCycle(year, quarter).months}{manager ? "" : " · set by manager"}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {week.label} (Fri–Thu)
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="rounded-full bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">leading</span> daily driver</span>
        <span className="flex items-center gap-1"><span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">lagging</span> outcome</span>
        <span className="text-slate-300">·</span>
        <span className="font-medium text-slate-500">vs target:</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-sky-500" /> &gt;120%</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-emerald-500" /> 100–119%</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-amber-400" /> 80–99%</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-rose-500" /> &lt;80%</span>
      </div>

      {loading || !data ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading KPIs…</div>
      ) : (
        <>
          {showAaron ? <Person name="Aaron" role="Orders · Reseller deliveries · Customer chats" accent="bg-indigo-500" kpis={data.aaron} /> : null}
          {showMaricel ? <Person name="Maricel" role="Returns documentation · Remittance recovery" accent="bg-teal-500" kpis={data.maricel} /> : null}
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
