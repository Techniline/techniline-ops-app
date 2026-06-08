"use client";

import { useEffect, useState } from "react";
import type { ComponentType, SVGProps } from "react";

import Link from "next/link";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import {
  ActionsIcon,
  ChecklistIcon,
  CocobluIcon,
} from "@/components/icons";
import { surface } from "@/components/ui";
import { computeActionSummary, fetchAmazonActions } from "@/lib/amazon-actions";
import { calculateCocobluSummary, fetchCocobluAgeing } from "@/lib/cocoblu";
import { fetchChecklistForDate, generateDailyTasks } from "@/lib/checklist";
import { formatAED } from "@/lib/format";
import {
  canViewChecklist,
  canViewCocoblu,
  canViewFinance,
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
    const order = ["checklist", "cocoblu", "amazon"];

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

      if (canViewCocoblu(profile)) {
        jobs.push(
          (async () => {
            try {
              const rows = await fetchCocobluAgeing();
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

  if (!profile) return null;

  const role = isManager(profile) ? "Manager" : "Staff";
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
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {role}
          </span>
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

      <KpiDashboard profile={profile} />
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
