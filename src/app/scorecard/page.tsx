"use client";

import { Fragment, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { MmTargetsModal } from "@/components/MmTargetsModal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { useAuth } from "@/app/providers/AuthProvider";
import { inputClass, surface } from "@/components/ui";
import { buildCycle, currentYearQuarter, cycleMonth, fetchStoredCycle, friThuWeek, saveCycle } from "@/lib/kpiCycle";
import { quarterMonths } from "@/lib/musicmajlis";
import { AARON_ID, fetchBreakHistory, type UserBreak } from "@/lib/breaks";
import { isManager } from "@/lib/permissions";
import { fetchScorecard, type Kpi, type Scorecard } from "@/lib/scorecard";
import { fetchWeeklyScorecard, type WeeklyRow, type WeeklyScorecard } from "@/lib/scorecardWeekly";

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

const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

// ── Break analysis (manager-only) ────────────────────────────────────────────

interface BreakDay {
  date: string;
  short: number;
  lunch: number;
  totalMinutes: number;
  manual: number;
  auto: number;
}

function groupBreaksByDay(breaks: UserBreak[]): BreakDay[] {
  const map = new Map<string, BreakDay>();
  for (const b of breaks) {
    const date = b.started_at.slice(0, 10);
    if (!map.has(date)) map.set(date, { date, short: 0, lunch: 0, totalMinutes: 0, manual: 0, auto: 0 });
    const d = map.get(date)!;
    if (b.type === "short") d.short += 1; else d.lunch += 1;
    const end = b.ended_at ?? b.expected_end_at;
    d.totalMinutes += Math.round((new Date(end).getTime() - new Date(b.started_at).getTime()) / 60_000);
    if (b.ended_by === "manual") d.manual += 1; else d.auto += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function BreakAnalysis({ cycle }: { cycle: { startIso: string; endIso: string; label: string } }) {
  const [breaks, setBreaks] = useState<UserBreak[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchBreakHistory(AARON_ID, cycle.startIso, cycle.endIso).then((b) => { if (alive) setBreaks(b); });
    return () => { alive = false; };
  }, [cycle.startIso, cycle.endIso]);

  if (!breaks) return <p className="text-sm text-slate-400 py-4">Loading break history…</p>;
  if (breaks.length === 0) return <p className="text-sm text-slate-400 py-4">No breaks recorded this cycle.</p>;

  const days = groupBreaksByDay(breaks);
  const totalShort = breaks.filter((b) => b.type === "short").length;
  const totalLunch = breaks.filter((b) => b.type === "lunch").length;
  const totalMins = days.reduce((s, d) => s + d.totalMinutes, 0);
  const totalManual = breaks.filter((b) => b.ended_by === "manual").length;
  const totalAuto = breaks.filter((b) => b.ended_by === "auto" || !b.ended_by).length;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
        {[
          { label: "Short breaks", value: totalShort, sub: "15 min each" },
          { label: "Lunch breaks", value: totalLunch, sub: "60 min each" },
          { label: "Total break time", value: `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`, sub: `${breaks.length} sessions` },
          { label: "Auto-expired", value: totalAuto, sub: `${totalManual} manual returns` },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{c.value}</p>
            <p className="text-xs text-slate-400">{c.sub}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-xs border-collapse">
          <thead className="bg-slate-100 dark:bg-slate-800">
            <tr>
              {["Date", "Short breaks", "Lunch breaks", "Total time", "Manual return", "Auto-expired"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-200 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200">{new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", weekday: "short" })}</td>
                <td className="px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-300">{d.short > 0 ? `${d.short}` : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-300">{d.lunch > 0 ? `${d.lunch}` : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-300">{d.totalMinutes}m</td>
                <td className="px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-300">{d.manual > 0 ? `${d.manual}` : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-300">{d.auto > 0 ? <span className="text-amber-600 font-medium">{d.auto}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Cell colour for the weekly grid: band on achievement vs target (AED = neutral). */
function cellInfo(row: WeeklyRow, v: number | null): { text: string; cls: string } {
  if (v == null) return { text: "—", cls: "text-slate-300 dark:text-slate-600" };
  const fmt = row.uom === "AED" ? v.toLocaleString() : row.uom === "days" ? `${v}d` : row.uom === "%" ? `${v}%` : String(v);
  if (row.uom === "AED") return { text: fmt, cls: "bg-slate-50 text-slate-700 dark:bg-slate-800/50 dark:text-slate-200" };
  const ach = row.higherIsBetter ? (v / row.targetValue) * 100 : v <= 0 ? 200 : (row.targetValue / v) * 100;
  const cls = ach > 120 ? "bg-sky-500 text-white" : ach >= 100 ? "bg-emerald-500 text-white" : ach >= 80 ? "bg-amber-400 text-amber-950" : "bg-rose-500 text-white";
  return { text: fmt, cls };
}

function WeeklyGrid({ grid, showAaron, showMaricel }: { grid: WeeklyScorecard; showAaron: boolean; showMaricel: boolean }) {
  const rows = grid.rows.filter((r) => (r.person === "Aaron" ? showAaron : showMaricel));
  let lastPerson = "";
  return (
    <div className={`${surface} overflow-x-auto p-0`}>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-800">
            <th className="sticky left-0 z-10 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200">KPI</th>
            <th className="px-2 py-2 text-center font-semibold text-slate-600 dark:text-slate-200">Target</th>
            <th className="px-2 py-2 text-center font-bold text-slate-700 dark:text-slate-100">QTD</th>
            {grid.weeks.map((w) => <th key={w} className="whitespace-nowrap px-2 py-2 text-center text-[11px] font-medium text-slate-500">{w}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const header = r.person !== lastPerson ? r.person : null;
            lastPerson = r.person;
            const tgt = r.uom === "AED" ? "—" : r.higherIsBetter ? `≥${r.targetValue}${r.uom === "%" ? "%" : ""}` : `≤${r.targetValue}${r.uom === "days" ? "d" : ""}`;
            const qtd = cellInfo(r, r.qtd);
            return (
              <Fragment key={r.person + r.label}>
                {header ? (
                  <tr><td colSpan={3 + grid.weeks.length} className="bg-slate-50 px-3 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">{header}</td></tr>
                ) : null}
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-200">{r.label}</td>
                  <td className="px-2 py-1.5 text-center text-xs text-slate-400">{tgt}</td>
                  <td className={`px-2 py-1.5 text-center text-xs font-bold tabular-nums ${qtd.cls}`}>{qtd.text}</td>
                  {r.weekly.map((v, i) => {
                    const c = cellInfo(r, v);
                    return <td key={i} className={`px-2 py-1.5 text-center text-xs tabular-nums ${c.cls}`}>{c.text}</td>;
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScorecardContent() {
  const { profile } = useAuth();
  const manager = isManager(profile);
  const canView = manager || profile?.id === AARON_ID || profile?.id === MARICEL_ID;

  const [data, setData] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"cards" | "weekly">("cards");
  const [grid, setGrid] = useState<WeeklyScorecard | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [reload, setReload] = useState(0);
  const init = currentYearQuarter();
  const [year, setYear] = useState(init.year);
  const [quarter, setQuarter] = useState(init.quarter);
  const [mmMonth, setMmMonth] = useState(""); // MM-sales card month ("YYYY-MM-01")
  const week = friThuWeek();

  // Reset the MM-sales month to the cycle's default whenever the quarter changes.
  useEffect(() => {
    setMmMonth(cycleMonth(buildCycle(year, quarter)).monthKey);
  }, [year, quarter]);

  // Load the shared cycle (set by a manager) from the DB on mount.
  useEffect(() => {
    let alive = true;
    fetchStoredCycle().then((c) => { if (alive) { setYear(c.year); setQuarter(c.quarter); } });
    return () => { alive = false; };
  }, []);

  // Recompute KPIs whenever the cycle (or the picked MM month) changes.
  useEffect(() => {
    if (!mmMonth) return; // wait for the month default to be set
    let alive = true;
    setLoading(true);
    fetchScorecard(buildCycle(year, quarter), mmMonth).then((d) => { if (alive) { setData(d); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [year, quarter, reload, mmMonth]);

  // Weekly grid — fetched when that view is open (and refreshed on cycle change).
  useEffect(() => {
    if (view !== "weekly") return;
    let alive = true;
    setGridLoading(true);
    fetchWeeklyScorecard(buildCycle(year, quarter)).then((g) => { if (alive) { setGrid(g); setGridLoading(false); } }).catch(() => alive && setGridLoading(false));
    return () => { alive = false; };
  }, [view, year, quarter, reload]);

  function changeCycle(y: number, q: number) {
    setYear(y); setQuarter(q);
    void saveCycle(y, q).catch(() => { /* non-manager can't save; ignored */ });
  }

  const cy = currentYearQuarter().year;
  const years = [cy - 1, cy, cy + 1];

  async function exportCsv() {
    setExporting(true);
    try {
      const cycle = buildCycle(year, quarter);
      const [sc, wg, brks] = await Promise.all([
        data ? Promise.resolve(data) : fetchScorecard(cycle),
        fetchWeeklyScorecard(cycle),
        fetchBreakHistory(AARON_ID, cycle.startIso, cycle.endIso),
      ]);

      const lines: string[] = [];
      const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

      // KPI summary
      lines.push(`KPI Summary — ${cycle.label}`);
      lines.push("Person,KPI,Value,Target,Achievement %,Status,Type");
      for (const [person, kpis] of [["Aaron", sc.aaron], ["Maricel", sc.maricel]] as [string, Kpi[]][]) {
        for (const k of kpis) {
          lines.push([q(person), q(k.label), q(k.display), q(k.target ?? "—"), k.achievement != null ? k.achievement : "—", q(k.status), q(k.type)].join(","));
        }
      }

      // Weekly grid
      lines.push("", `Weekly Grid — ${cycle.label}`);
      lines.push(["Person", "KPI", "Target", "QTD", ...wg.weeks].map(q).join(","));
      for (const r of wg.rows) {
        const tgt = r.uom === "AED" ? "—" : r.higherIsBetter ? `>=${r.targetValue}${r.uom === "%" ? "%" : ""}` : `<=${r.targetValue}${r.uom === "days" ? "d" : ""}`;
        lines.push([q(r.person), q(r.label), q(tgt), r.qtd ?? "—", ...r.weekly.map((v) => v ?? "—")].join(","));
      }

      // Break analysis
      lines.push("", `Aaron Break History — ${cycle.label}`);
      lines.push(["Date", "Type", "Started", "Expected End", "Ended At", "Ended By", "Duration (min)"].map(q).join(","));
      for (const b of brks) {
        const end = b.ended_at ?? b.expected_end_at;
        const mins = Math.round((new Date(end).getTime() - new Date(b.started_at).getTime()) / 60_000);
        lines.push([q(b.started_at.slice(0, 10)), q(b.type), q(b.started_at), q(b.expected_end_at), q(b.ended_at ?? "(auto)"), q(b.ended_by ?? "auto"), mins].join(","));
      }

      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kpi-${cycle.label.replace(/\s/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

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
        {view === "cards" ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400">MM sales month</span>
            <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs dark:border-slate-700">
              {quarterMonths(year, quarter).map((m) => (
                <button key={m.key} type="button" onClick={() => setMmMonth(m.key)}
                  className={`px-2 py-1 font-medium ${mmMonth === m.key ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>
                  {m.label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs dark:border-slate-700">
            <button type="button" onClick={() => setView("cards")} className={`px-2.5 py-1 font-medium ${view === "cards" ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>Cards</button>
            <button type="button" onClick={() => setView("weekly")} className={`px-2.5 py-1 font-medium ${view === "weekly" ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>Weekly grid</button>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{week.label} (Fri–Thu)</span>
          {manager ? (
            <>
              <button type="button" onClick={() => setShowTargets(true)}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                🎯 Set targets
              </button>
              <button type="button" onClick={() => void exportCsv()} disabled={exporting}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                {exporting ? "Exporting…" : "⬇ Export CSV"}
              </button>
            </>
          ) : null}
        </div>
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

      {view === "weekly" ? (
        gridLoading || !grid ? (
          <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading weekly grid…</div>
        ) : (
          <WeeklyGrid grid={grid} showAaron={showAaron} showMaricel={showMaricel} />
        )
      ) : loading || !data ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading KPIs…</div>
      ) : (
        <>
          {showAaron ? <Person name="Aaron" role="Orders · Reseller deliveries · Customer chats" accent="bg-indigo-500" kpis={data.aaron} /> : null}
          {showMaricel ? <Person name="Maricel" role="Returns documentation · Remittance recovery" accent="bg-teal-500" kpis={data.maricel} /> : null}
        </>
      )}

      {/* Break analysis — manager only */}
      {manager ? (
        <div className={`${surface} mt-6 p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">☕ Aaron — Break History</h2>
              <p className="text-xs text-slate-500 mt-0.5">Auto-expired = he did not click "I'm back" — system resumed automatically. Not shown to Aaron.</p>
            </div>
          </div>
          <BreakAnalysis cycle={buildCycle(year, quarter)} />
        </div>
      ) : null}

      {manager && showTargets ? (
        <MmTargetsModal
          year={year}
          quarter={quarter}
          createdBy={profile?.id ?? ""}
          onClose={() => setShowTargets(false)}
          onSaved={() => setReload((n) => n + 1)}
        />
      ) : null}
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
