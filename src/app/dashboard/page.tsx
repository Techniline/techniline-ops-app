"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComponentType, FormEvent, SVGProps } from "react";

import Link from "next/link";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import {
  ActionsIcon,
  ChecklistIcon,
  CocobluIcon,
  LpTrackerIcon,
  PrioritiesIcon,
} from "@/components/icons";
import { btnSecondary, surface } from "@/components/ui";
import { AaronDealsBand } from "@/components/AaronDealsBand";
import { ManagerScorecard } from "@/components/ManagerScorecard";
import { ZohoPipelineBand } from "@/components/ZohoPipelineBand";
import { supabase } from "@/lib/supabaseClient";
import { WeeklySummaryModal } from "@/components/WeeklySummaryModal";
import { computeActionSummary, fetchAmazonActions } from "@/lib/amazon-actions";
import { calculateCocobluSummary, fetchAllCocobluAgeing } from "@/lib/cocoblu";
import { computeLpSummary, computePriceAlerts, fetchLpItemsWindow } from "@/lib/lp";
import { computeResellerKpis, fetchDealLogs } from "@/lib/reseller";
import {
  actionAbandonedCart,
  buildPaceSeries,
  computeMmKpis,
  createDealForCart,
  fetchAbandonedCarts,
  fetchActionedThisMonth,
  fetchMmMetrics,
  fetchMmTarget,
  fetchRecoveredThisMonth,
  logRecoveredCart,
  remainingWorkingDays,
  setMmTarget,
  type AbandonedCart,
  type AbandonedResult,
  type MmMetrics,
  type MmRecoveredCart,
  type MonthActionCounts,
} from "@/lib/musicmajlis";
import { btnPrimary, inputClass } from "@/components/ui";
import {
  fetchBreachCountSince,
  fetchChecklistForDate,
  generateDailyTasks,
} from "@/lib/checklist";
import { fetchPriorities, priorityDisplayStatus } from "@/lib/priorities";
import { formatAED } from "@/lib/format";
import {
  canViewChecklist,
  canViewCocoblu,
  canViewFinance,
  canViewLpTracker,
  isManager,
} from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** Local-time today as YYYY-MM-DD (matches `daily_tasks.task_date`). */
function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

interface Kpi {
  label: string;
  value: string;
  tone?: string;
  sub?: string;
}
interface KpiGroup {
  key: string;
  title: string;
  href: string;
  kpis: Kpi[];
}

// Pastel accent per metric group (bar + label tint + tile gradient).
const KPI_ACCENTS: Record<string, { bar: string; label: string; tile: string }> = {
  checklist: {
    bar: "bg-indigo-400/80 group-hover:bg-indigo-500",
    label: "text-indigo-700/90 dark:text-indigo-400/90",
    tile: "border-indigo-100 from-white to-indigo-50/50 hover:ring-indigo-200 dark:border-indigo-900/50 dark:from-slate-900 dark:to-indigo-950/20",
  },
  priorities: {
    bar: "bg-amber-400/80 group-hover:bg-amber-500",
    label: "text-amber-700/90 dark:text-amber-400/90",
    tile: "border-amber-100 from-white to-amber-50/50 hover:ring-amber-200 dark:border-amber-900/50 dark:from-slate-900 dark:to-amber-950/20",
  },
  reseller: {
    bar: "bg-violet-400/80 group-hover:bg-violet-500",
    label: "text-violet-700/90 dark:text-violet-400/90",
    tile: "border-violet-100 from-white to-violet-50/50 hover:ring-violet-200 dark:border-violet-900/50 dark:from-slate-900 dark:to-violet-950/20",
  },
  cocoblu: {
    bar: "bg-emerald-400/80 group-hover:bg-emerald-500",
    label: "text-emerald-700/90 dark:text-emerald-400/90",
    tile: "border-emerald-100 from-white to-emerald-50/50 hover:ring-emerald-200 dark:border-emerald-900/50 dark:from-slate-900 dark:to-emerald-950/20",
  },
  lp: {
    bar: "bg-sky-400/80 group-hover:bg-sky-500",
    label: "text-sky-700/90 dark:text-sky-400/90",
    tile: "border-sky-100 from-white to-sky-50/50 hover:ring-sky-200 dark:border-sky-900/50 dark:from-slate-900 dark:to-sky-950/20",
  },
  amazon: {
    bar: "bg-rose-400/80 group-hover:bg-rose-500",
    label: "text-rose-700/90 dark:text-rose-400/90",
    tile: "border-rose-100 from-white to-rose-50/50 hover:ring-rose-200 dark:border-rose-900/50 dark:from-slate-900 dark:to-rose-950/20",
  },
};
const KPI_ACCENT_DEFAULT = {
  bar: "bg-slate-300 group-hover:bg-slate-400",
  label: "text-slate-500",
  tile: "border-slate-200/80 from-white to-slate-50/70 hover:ring-slate-200 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950",
};

function KpiTile({ kpi, accentKey }: { kpi: Kpi; accentKey?: string }) {
  const a = (accentKey && KPI_ACCENTS[accentKey]) || KPI_ACCENT_DEFAULT;
  return (
    <div
      className={`group relative flex h-full min-h-[96px] flex-col justify-between overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_6px_16px_-8px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-white/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:ring-white/5 ${a.tile}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 transition-all group-hover:w-1.5 ${a.bar}`} />
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${a.label}`}>{kpi.label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${kpi.tone ?? "text-slate-900 dark:text-slate-100"}`}>
        {kpi.value}
      </p>
      {kpi.sub ? <p className="mt-0.5 text-xs text-slate-400">{kpi.sub}</p> : null}
    </div>
  );
}

/** KPI strip scoped to the modules the user can access. Each module loads
 *  independently — a failure in one never blocks the others. */
function KpiDashboard({ profile }: { profile: UserProfile }) {
  const [groups, setGroups] = useState<KpiGroup[] | null>(null);

  useEffect(() => {
    let active = true;
    const order = ["checklist", "priorities", "reseller", "cocoblu", "lp", "amazon"];
    const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

    (async () => {
      const result: KpiGroup[] = [];
      const jobs: Promise<void>[] = [];

      if (canViewChecklist(profile)) {
        jobs.push(
          (async () => {
            try {
              try {
                await generateDailyTasks();
              } catch {
                /* generation is best-effort */
              }
              const list = await fetchChecklistForDate({
                date: todayISODate(),
                profile,
              });
              const total = list.length;
              const done = list.filter((t) => t.status === "submitted").length;
              const open = total - done;
              const pct = total === 0 ? 0 : Math.round((done / total) * 100);
              result.push({
                key: "checklist",
                title: "Today's Checklist",
                href: "/checklist",
                kpis: [
                  { label: "Tasks Today", value: String(total) },
                  {
                    label: "Completed",
                    value: String(done),
                    tone: "text-emerald-600 dark:text-emerald-400",
                    sub: `${pct}% done`,
                  },
                  {
                    label: "Open",
                    value: String(open),
                    tone: open > 0 ? "text-amber-600 dark:text-amber-400" : undefined,
                  },
                ],
              });
            } catch {
              /* skip module on error */
            }
          })()
        );
      }

      if (canViewChecklist(profile)) {
        jobs.push(
          (async () => {
            try {
              const prios = await fetchPriorities(profile);
              const openP = prios.filter((p) => priorityDisplayStatus(p) !== "completed");
              const avg =
                openP.length === 0
                  ? 0
                  : Math.round(
                      openP.reduce((s, p) => s + (p.progress_pct ?? 0), 0) / openP.length
                    );
              const today = todayISODate();
              const overdue = openP.filter(
                (p) => (p.due_date_revised ?? p.due_date) < today
              ).length;
              const since = new Date(Date.now() - 7 * 86_400_000);
              const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
              const breaches = await fetchBreachCountSince(sinceIso);
              result.push({
                key: "priorities",
                title: "Priorities & Breaches",
                href: "/checklist",
                kpis: [
                  { label: "Open Priorities", value: String(openP.length) },
                  { label: "Avg Progress", value: `${avg}%` },
                  {
                    label: "Overdue",
                    value: String(overdue),
                    tone: overdue > 0 ? "text-red-600 dark:text-red-400" : undefined,
                  },
                  {
                    label: "Breaches (7d)",
                    value: String(breaches),
                    tone: breaches > 0 ? "text-red-600 dark:text-red-400" : undefined,
                  },
                ],
              });
            } catch {
              /* skip module on error */
            }
          })()
        );
      }

      if (canViewCocoblu(profile)) {
        jobs.push(
          (async () => {
            try {
              const rows = await fetchAllCocobluAgeing();
              const s = calculateCocobluSummary(rows);
              result.push({
                key: "cocoblu",
                title: "Cocoblu Ageing",
                href: "/cocoblu",
                kpis: [
                  { label: "Open Records", value: s.totalOpenRecords.toLocaleString() },
                  { label: "Qty Remaining", value: s.totalQtyRemaining.toLocaleString() },
                  {
                    label: "90+ Day Records",
                    value: s.over90Records.toLocaleString(),
                    tone: s.over90Records > 0 ? "text-red-600 dark:text-red-400" : undefined,
                  },
                  {
                    label: "Warning Records",
                    value: s.warningRecords.toLocaleString(),
                    tone:
                      s.warningRecords > 0 ? "text-orange-600 dark:text-orange-400" : undefined,
                  },
                ],
              });
            } catch {
              /* skip module on error */
            }
          })()
        );
      }

      if (isManager(profile) || profile.id === MARICEL_ID) {
        jobs.push(
          (async () => {
            try {
              const logs = await fetchDealLogs();
              const k = computeResellerKpis(logs);
              result.push({
                key: "reseller",
                title: "Reseller Deals (Zoho)",
                href: "/checklist",
                kpis: [
                  { label: "Logged Today", value: k.today.toLocaleString() },
                  { label: "Valid", value: k.valid.toLocaleString(), tone: "text-emerald-600 dark:text-emerald-400" },
                  {
                    label: "Pending",
                    value: k.pending.toLocaleString(),
                    tone: k.pending > 0 ? "text-slate-500" : undefined,
                  },
                  {
                    label: "Invalid / API err",
                    value: (k.invalid + k.apiError).toLocaleString(),
                    tone: k.invalid + k.apiError > 0 ? "text-amber-600 dark:text-amber-400" : undefined,
                  },
                  { label: "Week / Month", value: `${k.week} / ${k.month}` },
                  { label: "Deal Value (valid)", value: formatAED(k.totalValue) },
                ],
              });
            } catch {
              /* skip module on error */
            }
          })()
        );
      }

      if (canViewLpTracker(profile)) {
        jobs.push(
          (async () => {
            try {
              const items = await fetchLpItemsWindow({ status: "open", limit: 5000 });
              const s = computeLpSummary(items);
              const alertCount = computePriceAlerts(items).size;
              result.push({
                key: "lp",
                title: "LP Tracker",
                href: "/lp",
                kpis: [
                  { label: "Open LPs", value: s.openLpCount.toLocaleString() },
                  { label: "Qty In Hand", value: s.totalRemainingQty.toLocaleString() },
                  { label: "Value In Hand", value: formatAED(s.totalRemainingValue) },
                  {
                    label: "Aged 90+ / Alerts",
                    value: `${s.aged90Lines.toLocaleString()} / ${alertCount.toLocaleString()}`,
                    tone: s.aged90Lines > 0 ? "text-red-600 dark:text-red-400" : undefined,
                  },
                ],
              });
            } catch {
              /* skip module on error */
            }
          })()
        );
      }

      if (canViewFinance(profile)) {
        jobs.push(
          (async () => {
            try {
              const actions = await fetchAmazonActions();
              const s = computeActionSummary(actions);
              result.push({
                key: "amazon",
                title: "Amazon Actions",
                href: "/amazon-actions",
                kpis: [
                  { label: "Open Actions", value: s.openCount.toLocaleString() },
                  {
                    label: "Missing Docs",
                    value: s.missingDocCount.toLocaleString(),
                    tone: s.missingDocCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined,
                  },
                  {
                    label: "Overdue (SLA)",
                    value: s.overdueCount.toLocaleString(),
                    tone: s.overdueCount > 0 ? "text-red-600 dark:text-red-400" : undefined,
                  },
                  { label: "Open Exposure", value: formatAED(s.exposure.total) },
                ],
              });
            } catch {
              /* skip module on error */
            }
          })()
        );
      }

      await Promise.allSettled(jobs);
      result.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      if (active) setGroups(result);
    })();

    return () => {
      active = false;
    };
  }, [profile]);

  if (groups === null) {
    return (
      <div className={`${surface} mt-8 p-6 text-center text-sm text-slate-500`}>
        Loading your metrics…
      </div>
    );
  }
  if (groups.length === 0) return null;

  return (
    <div className="mt-8 flex flex-col gap-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Key Metrics
      </h2>
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {g.title}
            </h3>
            <Link
              href={g.href}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              View →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {g.kpis.map((k, i) => (
              <KpiTile key={i} kpi={k} accentKey={g.key} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ----------------------- Music Majlis sales band ---------------------- */

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";

function MmTile({ label, value, tone, big = false }: { label: string; value: string; tone?: string; big?: boolean }) {
  const valueTone = tone ?? "text-slate-900 dark:text-slate-100";
  // For big currency tiles, show "AED" as a small label above the number so the
  // figure is the clean hero and never wraps awkwardly.
  const aed = big && value.startsWith("AED ");
  const amount = aed ? value.slice(4) : value;
  return (
    <div
      className={`group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border bg-gradient-to-br shadow-sm ring-1 ring-transparent transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        big
          ? "min-h-[128px] border-emerald-200 from-emerald-50 to-white p-5 hover:ring-emerald-300 dark:border-emerald-800 dark:from-emerald-950/40 dark:to-slate-900"
          : "min-h-[112px] items-center text-center border-emerald-100 from-white to-emerald-50/40 p-4 hover:ring-emerald-200 dark:border-emerald-900/60 dark:from-slate-900 dark:to-emerald-950/20 dark:hover:ring-emerald-800"
      }`}
    >
      <span className={`absolute inset-y-0 left-0 transition-all group-hover:w-1.5 ${big ? "w-1.5 bg-emerald-500" : "w-1 bg-emerald-400/70 group-hover:bg-emerald-500 dark:bg-emerald-700"}`} />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700/90 dark:text-emerald-400/90">{label}</p>
      {aed ? (
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-sm font-semibold text-emerald-600/70 dark:text-emerald-500/70">AED</span>
          <span className={`text-3xl font-bold tabular-nums leading-none tracking-tight ${valueTone}`}>{amount}</span>
        </div>
      ) : (
        <p className={`mt-1 font-bold tabular-nums leading-tight ${big ? "text-3xl" : "text-2xl"} ${valueTone}`}>{value}</p>
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Cumulative actual net sales vs the ideal target pace for the month. */
function PaceChart({ target, daily }: { target: number; daily: Record<string, number> }) {
  const pts = buildPaceSeries(target, daily);
  if (pts.length < 2 || target <= 0) return null;
  const W = 640;
  const H = 150;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 16;
  const maxY = Math.max(target, ...pts.map((p) => Math.max(p.pace, p.actual ?? 0)), 1);
  const n = pts.length;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);

  const pacePath = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.pace).toFixed(1)}`).join(" ");
  const actualPts = pts.filter((p) => p.actual != null);
  const actualPath = actualPts
    .map((p, i) => `${i ? "L" : "M"}${x(p.day - 1).toFixed(1)},${y(p.actual as number).toFixed(1)}`)
    .join(" ");
  const last = actualPts[actualPts.length - 1];
  const today = pts.find((p) => p.isToday);
  const ahead = today && last ? (last.actual as number) - today.pace : 0;

  return (
    <div className="mt-3 rounded-2xl border border-emerald-100 bg-white/70 p-4 shadow-sm dark:border-emerald-900/60 dark:bg-slate-900/40">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700/90 dark:text-emerald-400/90">
          Sales pace vs target — this month
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            ahead >= 0
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {ahead >= 0 ? "▲ Ahead of pace " : "▼ Behind pace "}
          {formatAED(Math.abs(Math.round(ahead)))}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" preserveAspectRatio="none">
        <path d={pacePath} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" className="text-slate-300 dark:text-slate-600" />
        {actualPath ? (
          <path d={actualPath} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {last ? <circle cx={x(last.day - 1)} cy={y(last.actual as number)} r="3.5" className="fill-emerald-500" /> : null}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-emerald-500" /> Achieved</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-slate-400" /> Target pace</span>
        <span className="ml-auto">Day {today?.day ?? "—"} of {n}</span>
      </div>
    </div>
  );
}

function MusicMajlisPanel({ profile }: { profile: UserProfile }) {
  const manager = isManager(profile);
  const [target, setTarget] = useState(0);
  const [metrics, setMetrics] = useState<MmMetrics | null>(null);
  const [recovered, setRecovered] = useState<MmRecoveredCart[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showTarget, setShowTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [showRecover, setShowRecover] = useState(false);
  const [orderRef, setOrderRef] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const [abandoned, setAbandoned] = useState<AbandonedResult | null>(null);
  const [showCarts, setShowCarts] = useState(false);
  const [cartBusy, setCartBusy] = useState<string | null>(null);
  const [actionCounts, setActionCounts] = useState<MonthActionCounts>({ actioned: 0, deals: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [t, m, r, a, ac] = await Promise.all([
      fetchMmTarget(),
      fetchMmMetrics(),
      fetchRecoveredThisMonth(),
      fetchAbandonedCarts(),
      fetchActionedThisMonth(),
    ]);
    setTarget(t?.target_amount ?? 0);
    setMetrics(m);
    setRecovered(r);
    setAbandoned(a);
    setActionCounts(ac);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Keep the figures live: refresh every 3 minutes and whenever the tab regains
  // focus, so incoming sales / returns adjust "Achieved" and today's target without
  // a manual reload. (Shopify net sales already nets out refunds.)
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 180_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Instant refresh when a Shopify webhook bumps the heartbeat (Supabase Realtime).
  // Fail-soft: if the table/realtime isn't set up, polling above still covers it.
  useEffect(() => {
    const ch = supabase
      .channel("shopify_sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopify_sync" }, () => { void load(); })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load]);

  const achieved = metrics?.netSales ?? 0;
  const k = computeMmKpis(target, achieved, recovered);
  const connected = metrics?.configured === true;

  async function saveTarget(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const amt = Number(targetInput);
    if (!Number.isFinite(amt) || amt < 0) return setError("Enter a valid target amount.");
    setBusy(true);
    try {
      await setMmTarget(amt, profile.id);
      setShowTarget(false);
      setTargetInput("");
      setBanner("Target updated.");
      await load();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  async function saveRecover(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (orderRef.trim() === "") return setError("Enter the recovered order number.");
    setBusy(true);
    try {
      const amt = recAmount.trim() === "" ? null : Number(recAmount);
      await logRecoveredCart(orderRef.trim(), amt != null && Number.isFinite(amt) ? amt : null, null);
      setShowRecover(false);
      setOrderRef("");
      setRecAmount("");
      setBanner("Recovered cart logged.");
      await load();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  async function clearCart(cart: AbandonedCart): Promise<void> {
    setError(null);
    setCartBusy(cart.id);
    try {
      await actionAbandonedCart(cart, "actioned", null);
      await load();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setCartBusy(null);
    }
  }

  async function undoCart(cart: AbandonedCart): Promise<void> {
    setError(null);
    setCartBusy(cart.id);
    try {
      await actionAbandonedCart(cart, "open", null);
      await load();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setCartBusy(null);
    }
  }

  async function makeDeal(cart: AbandonedCart): Promise<void> {
    setError(null);
    setBanner(null);
    setCartBusy(cart.id);
    try {
      const r = await createDealForCart(cart);
      if (r.status === "error") setError(r.message);
      else setBanner(r.status === "duplicate" ? `Duplicate — ${r.message}` : r.message);
      await load();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setCartBusy(null);
    }
  }

  const abandonedOpen = abandoned?.openCount ?? 0;
  const abandonedLabel = abandoned?.windowLabel ?? null;
  const abandonedTileValue = !connected
    ? "—"
    : abandonedLabel == null
      ? "—"
      : String(abandonedOpen);

  return (
    <section className="mt-8 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-white p-5 shadow-sm dark:border-emerald-900/60 dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-emerald-800 dark:text-emerald-300">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" />
          MUSICMAJLIS
          <span className="rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">Sales focus</span>
        </h2>
        <div className="flex gap-2">
          {manager ? (
            <button type="button" onClick={() => { setTargetInput(target ? String(target) : ""); setShowTarget(true); }} className={btnSecondary}>Set MM target</button>
          ) : null}
          <button type="button" onClick={() => setShowRecover(true)} className={btnPrimary}>Log recovered cart</button>
        </div>
      </div>

      {banner ? <p className="mb-2 text-xs text-emerald-700 dark:text-emerald-400">{banner}</p> : null}
      {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
      {!connected && !loading ? (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">Shopify not connected yet — net sales &amp; abandoned carts show “—”. Set the env vars to light them up.</p>
      ) : null}

      {/* Top row — the two headline sales figures, large and roomy. */}
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
        <MmTile label="Monthly Target" value={formatAED(k.target)} big />
        <MmTile label="Achieved (net sales)" value={connected ? formatAED(k.achieved) : "—"} tone="text-emerald-700 dark:text-emerald-400" big />
      </div>

      {/* Supporting metrics below. */}
      <div className="mt-3 grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <MmTile label="% Achieved" value={target > 0 && connected ? `${Math.round(k.pct)}%` : "—"} tone={k.pct >= 100 ? "text-emerald-700 dark:text-emerald-400" : undefined} />
        <MmTile label={`Today's Target (${remainingWorkingDays()}d left)`} value={target > 0 ? formatAED(k.todayTarget) : "—"} />
        <button
          type="button"
          onClick={() => setShowCarts((s) => !s)}
          className="group relative flex h-full min-h-[112px] flex-col items-center justify-between overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-white to-amber-50/60 p-4 text-center shadow-sm ring-1 ring-transparent transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-amber-300 dark:border-amber-900/60 dark:from-slate-900 dark:to-amber-950/20"
        >
          <span className="absolute inset-y-0 left-0 w-1 bg-amber-400/80 transition-all group-hover:w-1.5 group-hover:bg-amber-500 dark:bg-amber-700" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700/90 dark:text-amber-400/90">
            Abandoned Carts{abandonedLabel ? ` (${abandonedLabel})` : ""}
          </p>
          <div className="flex flex-col items-center">
            <p className="text-2xl font-bold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">{abandonedTileValue}</p>
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-gradient-to-b from-amber-100 to-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.12)] transition-all group-hover:from-amber-200 group-hover:to-amber-300 group-active:translate-y-px group-active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)] dark:border-amber-700 dark:from-amber-800 dark:to-amber-900 dark:text-amber-100">
              {showCarts ? "Hide list ▲" : "Action carts ▼"}
            </span>
          </div>
        </button>
        <MmTile label="Recovered (this mo)" value={`${k.recoveredCount} · ${formatAED(k.recoveredValue)}`} />
        <MmTile
          label="Abandoned (this mo)"
          value={connected && metrics?.abandonedCarts != null ? String(metrics.abandonedCarts) : "—"}
          tone="text-amber-700 dark:text-amber-400"
        />
        <MmTile
          label="Actioned · Deals (this mo)"
          value={`${actionCounts.actioned + actionCounts.deals} · ${actionCounts.deals}`}
        />
        <MmTile
          label="Recovery Rate (this mo)"
          value={
            connected && metrics?.abandonedCarts != null && metrics.abandonedCarts > 0
              ? `${Math.round((k.recoveredCount / metrics.abandonedCarts) * 100)}%`
              : "—"
          }
          tone="text-emerald-700 dark:text-emerald-400"
        />
      </div>

      {connected && target > 0 ? <PaceChart target={target} daily={metrics?.daily ?? {}} /> : null}

      {showCarts ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white/70 p-3 dark:border-amber-900 dark:bg-slate-900/30">
          {!connected ? (
            <p className="text-xs text-amber-700">Shopify not connected — connect it to load abandoned carts.</p>
          ) : abandonedLabel == null ? (
            <p className="text-xs text-slate-500">Sunday — nothing to action. Monday will show Saturday + Sunday carts.</p>
          ) : (abandoned?.carts.length ?? 0) === 0 ? (
            <p className="text-xs text-slate-500">No abandoned carts for {abandonedLabel}. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {abandoned!.carts.map((c) => {
                const done = c.actionStatus !== "open";
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800 dark:text-slate-200">
                        {c.customerName ?? c.customerEmail ?? "Unknown customer"}
                        {c.total != null ? <span className="ml-2 text-slate-500">{formatAED(c.total)}</span> : null}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">
                        {c.customerEmail ?? "no email"}
                        {c.actionStatus === "deal_created" && c.zohoDealUrl ? (
                          <>
                            {" · "}
                            <a href={c.zohoDealUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                              Zoho deal
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {c.recoveryUrl ? (
                      <a href={c.recoveryUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-700 underline">
                        Recovery link
                      </a>
                    ) : null}
                    {done ? (
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          {c.actionStatus === "deal_created" ? "Deal" : "Actioned"}
                        </span>
                        <button
                          type="button"
                          disabled={cartBusy === c.id}
                          onClick={() => undoCart(c)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                          title="Undo — put this cart back to open"
                        >
                          {cartBusy === c.id ? "…" : "Undo"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={cartBusy === c.id}
                          onClick={() => makeDeal(c)}
                          className="rounded-md border border-indigo-300 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300"
                        >
                          {cartBusy === c.id ? "…" : "Create Zoho deal"}
                        </button>
                        <button
                          type="button"
                          disabled={cartBusy === c.id}
                          onClick={() => clearCart(c)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                        >
                          {cartBusy === c.id ? "…" : "Mark actioned"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {showTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setShowTarget(false)}>
          <form onSubmit={saveTarget} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">Set this month’s MM target</h3>
            <input type="number" min="0" step="100" className={inputClass} placeholder="Target (AED)" value={targetInput} onChange={(e) => setTargetInput(e.target.value)} autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowTarget(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      ) : null}

      {showRecover ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setShowRecover(false)}>
          <form onSubmit={saveRecover} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Log recovered cart</h3>
            <p className="mb-3 text-xs text-slate-500">Enter the recovered Shopify order number — it’s validated against Shopify as proof.</p>
            <input className={inputClass} placeholder="Order # (e.g. #1234)" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} autoFocus />
            <input type="number" min="0" step="0.01" className={`${inputClass} mt-2`} placeholder="Amount (optional — auto from Shopify)" value={recAmount} onChange={(e) => setRecAmount(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowRecover(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Validating…" : "Validate & Log"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

interface ModuleCard {
  key: string;
  title: string;
  description: string;
  href: string | null;
  icon: IconType;
  accent: string;
  tint: string;
  show: boolean;
  comingSoon: boolean;
}

// Glossy + embossed card base (pastel gradient comes from each card's `tint`).
const CARD_BASE =
  "group rounded-2xl border p-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-inset ring-white/60 transition-all duration-200 dark:ring-white/5";

function DashboardContent() {
  const { profile } = useAuth();
  const [showWeekly, setShowWeekly] = useState(false);

  if (!profile) return null;

  const managerView = isManager(profile);
  const role = managerView ? "Manager" : "Staff";
  const displayName = profile.full_name ?? profile.email ?? "there";

  const cards: ModuleCard[] = [
    {
      key: "checklist",
      title: "Checklist",
      description: "Track and submit your daily operational tasks.",
      href: "/checklist",
      icon: ChecklistIcon,
      accent:
        "bg-indigo-100 text-indigo-600 shadow-inner dark:bg-indigo-950 dark:text-indigo-300",
      tint:
        "border-indigo-200/70 bg-gradient-to-br from-indigo-50 to-white dark:border-indigo-900/50 dark:from-indigo-950/40 dark:to-slate-900",
      show: canViewChecklist(profile),
      comingSoon: false,
    },
    {
      key: "priorities",
      title: "Priorities",
      description: "Assigned objectives — progress, due dates, and completion.",
      href: "/priorities",
      icon: PrioritiesIcon,
      accent:
        "bg-amber-100 text-amber-600 shadow-inner dark:bg-amber-950 dark:text-amber-300",
      tint:
        "border-amber-200/70 bg-gradient-to-br from-amber-50 to-white dark:border-amber-900/50 dark:from-amber-950/40 dark:to-slate-900",
      show: true,
      comingSoon: false,
    },
    {
      key: "cocoblu",
      title: "Cocoblu",
      description: "Monitor stock ageing and manage remaining quantities.",
      href: "/cocoblu",
      icon: CocobluIcon,
      accent:
        "bg-emerald-100 text-emerald-600 shadow-inner dark:bg-emerald-950 dark:text-emerald-300",
      tint:
        "border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-slate-900",
      show: canViewCocoblu(profile),
      comingSoon: false,
    },
    {
      key: "lp",
      title: "LP Tracker",
      description: "Local purchase stock — ageing, draw-down, and price alerts.",
      href: "/lp",
      icon: LpTrackerIcon,
      accent:
        "bg-sky-100 text-sky-600 shadow-inner dark:bg-sky-950 dark:text-sky-300",
      tint:
        "border-sky-200/70 bg-gradient-to-br from-sky-50 to-white dark:border-sky-900/50 dark:from-sky-950/40 dark:to-slate-900",
      show: canViewLpTracker(profile),
      comingSoon: false,
    },
    {
      key: "amazon-actions",
      title: "Amazon Actions",
      description: "Act on Amazon issues — log references and drive closure.",
      href: "/amazon-actions",
      icon: ActionsIcon,
      accent:
        "bg-rose-100 text-rose-600 shadow-inner dark:bg-rose-950 dark:text-rose-300",
      tint:
        "border-rose-200/70 bg-gradient-to-br from-rose-50 to-white dark:border-rose-900/50 dark:from-rose-950/40 dark:to-slate-900",
      show: canViewFinance(profile),
      comingSoon: false,
    },
  ];

  const visibleCards = cards.filter((card) => card.show);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${displayName}`}
        subtitle="Here are the modules available to you."
        actions={
          <div className="flex items-center gap-2">
            {managerView ? (
              <button type="button" onClick={() => setShowWeekly(true)} className={btnSecondary}>
                Send weekly summary
              </button>
            ) : null}
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {role}
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map((card) => {
          const Icon = card.icon;
          const inner = (
            <>
              <div className="flex items-start justify-between">
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-lg ${card.accent}`}
                >
                  <Icon className="h-6 w-6" />
                </span>
                {card.comingSoon ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    Coming Soon
                  </span>
                ) : null}
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {card.title}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{card.description}</p>
            </>
          );

          if (card.href && !card.comingSoon) {
            return (
              <Link
                key={card.key}
                href={card.href}
                className={`${CARD_BASE} ${card.tint} hover:-translate-y-0.5 hover:shadow-lg`}
              >
                {inner}
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400">
                  Open
                  <span className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            );
          }

          return (
            <div
              key={card.key}
              className={`${CARD_BASE} ${card.tint} opacity-75`}
              aria-disabled="true"
            >
              {inner}
            </div>
          );
        })}
      </div>

      {managerView ? <ManagerScorecard profile={profile} /> : null}

      {isManager(profile) || profile.id === AARON_ID ? <MusicMajlisPanel profile={profile} /> : null}

      {managerView ? <ZohoPipelineBand /> : null}
      {!managerView && profile.id === AARON_ID ? <AaronDealsBand /> : null}

      <KpiDashboard profile={profile} />

      {showWeekly ? (
        <WeeklySummaryModal profile={profile} onClose={() => setShowWeekly(false)} />
      ) : null}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RouteGuard>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </RouteGuard>
  );
}
