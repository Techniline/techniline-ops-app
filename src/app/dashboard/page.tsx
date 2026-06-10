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
import { ManagerScorecard } from "@/components/ManagerScorecard";
import { WeeklySummaryModal } from "@/components/WeeklySummaryModal";
import { computeActionSummary, fetchAmazonActions } from "@/lib/amazon-actions";
import { calculateCocobluSummary, fetchAllCocobluAgeing } from "@/lib/cocoblu";
import { computeLpSummary, computePriceAlerts, fetchLpItemsWindow } from "@/lib/lp";
import { computeResellerKpis, fetchDealLogs } from "@/lib/reseller";
import {
  actionAbandonedCart,
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

function KpiTile({ kpi }: { kpi: Kpi }) {
  return (
    <div className={`${surface} p-4`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {kpi.label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          kpi.tone ?? "text-slate-900 dark:text-slate-100"
        }`}
      >
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
              <KpiTile key={i} kpi={k} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ----------------------- Music Majlis sales band ---------------------- */

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";

function MmTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-4 dark:border-emerald-900 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
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
    <section className="mt-8 rounded-2xl border-2 border-emerald-300 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-emerald-800 dark:text-emerald-300">
          MUSICMAJLIS
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">Sales focus</span>
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MmTile label="Monthly Target" value={formatAED(k.target)} />
        <MmTile label="Achieved (net sales)" value={connected ? formatAED(k.achieved) : "—"} tone="text-emerald-700 dark:text-emerald-400" />
        <MmTile label="% Achieved" value={target > 0 && connected ? `${Math.round(k.pct)}%` : "—"} tone={k.pct >= 100 ? "text-emerald-700 dark:text-emerald-400" : undefined} />
        <MmTile label={`Today's Target (${remainingWorkingDays()}d left)`} value={target > 0 ? formatAED(k.todayTarget) : "—"} />
        <button
          type="button"
          onClick={() => setShowCarts((s) => !s)}
          className="rounded-xl border border-amber-200 bg-white/70 p-3 text-left transition hover:border-amber-400 dark:border-amber-900 dark:bg-slate-900/40"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Abandoned Carts{abandonedLabel ? ` (${abandonedLabel})` : ""}
          </p>
          <p className="mt-1 text-xl font-semibold text-amber-700 dark:text-amber-400">{abandonedTileValue}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">{showCarts ? "Hide list ▲" : "Action carts ▼"}</p>
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
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        {c.actionStatus === "deal_created" ? "Deal" : "Actioned"}
                      </span>
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
  show: boolean;
  comingSoon: boolean;
}

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
        "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300",
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
        "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300",
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
        "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300",
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
        "bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-300",
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
        "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300",
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
                className={`${surface} group p-5 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-800`}
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
              className={`${surface} p-5 opacity-75`}
              aria-disabled="true"
            >
              {inner}
            </div>
          );
        })}
      </div>

      {managerView ? <ManagerScorecard profile={profile} /> : null}

      {isManager(profile) || profile.id === AARON_ID ? <MusicMajlisPanel profile={profile} /> : null}

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
