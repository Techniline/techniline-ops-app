"use client";

import type { ComponentType, SVGProps } from "react";
import { useEffect, useState } from "react";

import Link from "next/link";

import { useAuth } from "@/app/providers/AuthProvider";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import {
  ActionsIcon,
  AnalyticsIcon,
  CargoIcon,
  ResellerIcon,
  ReturnsIcon,
  ShopifyIcon,
} from "@/components/icons";
import { fetchLogisticsKpis, type LogisticsKpis } from "@/lib/logistics/dashboard";
import { isManager } from "@/lib/permissions";
import { supabase } from "@/lib/supabaseClient";

function SpapiCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [probe, setProbe] = useState<{ label: string; status: number | string }[] | null>(null);
  async function authHeader() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token ?? ""}` };
  }
  async function discover() {
    setBusy(true);
    setProbe(null);
    try {
      const res = await fetch("/api/spapi/probe", { headers: await authHeader() });
      const j = (await res.json().catch(() => ({}))) as { results?: { label: string; status: number | string }[] };
      setProbe(j.results ?? []);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/spapi/ping", { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; configured?: boolean; detail?: string; error?: string };
      if (j.configured === false) setResult({ ok: false, text: "Not configured — SP-API env vars aren't set / deployed yet." });
      else setResult({ ok: !!j.ok, text: j.ok ? `Connected ✓ — ${j.detail ?? ""}` : `Failed — ${j.error ?? j.detail ?? "unknown"}` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Amazon SP-API connection</span>
      <button
        type="button"
        onClick={test}
        disabled={busy}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {busy ? "Testing…" : "Test connection"}
      </button>
      <button
        type="button"
        onClick={discover}
        disabled={busy}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {busy ? "…" : "Discover access"}
      </button>
      {result ? (
        <span className={`text-sm ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.text}</span>
      ) : null}
      {probe ? (
        <ul className="basis-full text-xs text-slate-600 dark:text-slate-300">
          {probe.map((p) => (
            <li key={p.label}>
              <span className={p.status === 200 ? "text-emerald-700" : p.status === 403 ? "text-amber-600" : "text-rose-600"}>
                {String(p.status)}
              </span>{" "}
              · {p.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface Kpi {
  key: keyof LogisticsKpis;
  label: string;
  accent: string;
}

const KPIS: Kpi[] = [
  { key: "shopifyToday", label: "Shopify orders today", accent: "from-indigo-50 to-white text-indigo-700" },
  { key: "pendingFulfillment", label: "Pending fulfillment", accent: "from-sky-50 to-white text-sky-700" },
  { key: "trackingPending", label: "Tracking pending", accent: "from-amber-50 to-white text-amber-700" },
  { key: "prtRequested", label: "PRT requested", accent: "from-violet-50 to-white text-violet-700" },
  { key: "readyToDispatch", label: "Ready to dispatch", accent: "from-emerald-50 to-white text-emerald-700" },
  { key: "deliveredToday", label: "Delivered today", accent: "from-teal-50 to-white text-teal-700" },
  { key: "delayed24", label: "Delayed > 24h", accent: "from-orange-50 to-white text-orange-700" },
  { key: "delayed48", label: "Delayed > 48h", accent: "from-rose-50 to-white text-rose-700" },
  { key: "onHold", label: "On hold", accent: "from-red-50 to-white text-red-700" },
  { key: "missingInvoice", label: "Missing invoice", accent: "from-amber-50 to-white text-amber-700" },
  { key: "resellerPending", label: "Reseller pending", accent: "from-fuchsia-50 to-white text-fuchsia-700" },
  { key: "resellerDueToday", label: "Reseller due today", accent: "from-pink-50 to-white text-pink-700" },
  { key: "resellerDelayed", label: "Reseller delayed", accent: "from-rose-50 to-white text-rose-700" },
  { key: "cargoPending", label: "Cargo pending", accent: "from-cyan-50 to-white text-cyan-700" },
  { key: "returnsDocsPending", label: "Returns: docs pending", accent: "from-amber-50 to-white text-amber-700" },
];

// Glossy + embossed card base (matches the main staff dashboard).
const CARD_BASE =
  "group rounded-2xl border p-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-inset ring-white/60 transition-all duration-200 dark:ring-white/5";

interface ModuleCard {
  title: string;
  description: string;
  href: string;
  icon: IconType;
  accent: string;
  tint: string;
  comingSoon?: boolean;
}

const MODULES: ModuleCard[] = [
  {
    title: "Shopify / MusicMajlis Orders",
    description: "Sync, pick, pack and fulfill MusicMajlis orders.",
    href: "/logistics/orders",
    icon: ShopifyIcon,
    accent: "bg-indigo-100 text-indigo-600 shadow-inner dark:bg-indigo-950 dark:text-indigo-300",
    tint: "border-indigo-200/70 bg-gradient-to-br from-indigo-50 to-white dark:border-indigo-900/50 dark:from-indigo-950/40 dark:to-slate-900",
  },
  {
    title: "Reseller Deliveries",
    description: "Manual reseller delivery tracking.",
    href: "/logistics/reseller",
    icon: ResellerIcon,
    accent: "bg-fuchsia-100 text-fuchsia-600 shadow-inner dark:bg-fuchsia-950 dark:text-fuchsia-300",
    tint: "border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50 to-white dark:border-fuchsia-900/50 dark:from-fuchsia-950/40 dark:to-slate-900",
  },
  {
    title: "Cargo Deliveries",
    description: "Freight, AWB and carton tracking.",
    href: "/logistics/cargo",
    icon: CargoIcon,
    accent: "bg-cyan-100 text-cyan-600 shadow-inner dark:bg-cyan-950 dark:text-cyan-300",
    tint: "border-cyan-200/70 bg-gradient-to-br from-cyan-50 to-white dark:border-cyan-900/50 dark:from-cyan-950/40 dark:to-slate-900",
  },
  {
    title: "Product Transfers (PRT)",
    description: "Branch-to-branch transfer requests + email.",
    href: "/logistics/prt",
    icon: ActionsIcon,
    accent: "bg-violet-100 text-violet-600 shadow-inner dark:bg-violet-950 dark:text-violet-300",
    tint: "border-violet-200/70 bg-gradient-to-br from-violet-50 to-white dark:border-violet-900/50 dark:from-violet-950/40 dark:to-slate-900",
  },
  {
    title: "Delivery Reports",
    description: "Delay, branch support, courier & audit logs.",
    href: "/logistics/reports",
    icon: AnalyticsIcon,
    accent: "bg-emerald-100 text-emerald-600 shadow-inner dark:bg-emerald-950 dark:text-emerald-300",
    tint: "border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-slate-900",
  },
  {
    title: "Marketplace Returns",
    description: "Amazon / Noon returns received in the warehouse + documentation.",
    href: "/logistics/returns",
    icon: ReturnsIcon,
    accent: "bg-amber-100 text-amber-600 shadow-inner dark:bg-amber-950 dark:text-amber-300",
    tint: "border-amber-200/70 bg-gradient-to-br from-amber-50 to-white dark:border-amber-900/50 dark:from-amber-950/40 dark:to-slate-900",
  },
];

export default function LogisticsDashboardPage() {
  const { profile } = useAuth();
  const [kpis, setKpis] = useState<LogisticsKpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchLogisticsKpis()
      .then((k) => {
        if (alive) setKpis(k);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <LogisticsShell
      title="Logistics Dashboard"
      subtitle="Live operational snapshot across all delivery channels."
      page="dashboard"
    >
      {kpis?.notSetUp ? (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          The logistics database tables aren&apos;t created yet. Run the SQL in
          <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/60">LOGISTICS-SETUP.md</code>
          to activate this module.
        </div>
      ) : null}

      {isManager(profile) ? <SpapiCheck /> : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {KPIS.map((kpi) => (
          <div
            key={kpi.key}
            className={`relative rounded-2xl border border-slate-200 bg-gradient-to-br p-4 shadow-sm ring-1 ring-inset ring-white/60 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950 ${kpi.accent}`}
          >
            <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-slate-500">
              {kpi.label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {loading ? "…" : ((kpis?.[kpi.key] as number) ?? 0)}
            </p>
          </div>
        ))}
      </div>

      {/* Module cards — same look as the main staff dashboard */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-slate-400">Modules</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((card) => {
          const Icon = card.icon;
          const inner = (
            <>
              <div className="flex items-start justify-between">
                <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${card.accent}`}>
                  <Icon className="h-6 w-6" />
                </span>
                {card.comingSoon ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    Coming Soon
                  </span>
                ) : null}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{card.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{card.description}</p>
            </>
          );

          if (card.comingSoon) {
            return (
              <div key={card.href} className={`${CARD_BASE} ${card.tint} opacity-75`} aria-disabled="true">
                {inner}
              </div>
            );
          }
          return (
            <Link
              key={card.href}
              href={card.href}
              className={`${CARD_BASE} ${card.tint} hover:-translate-y-0.5 hover:shadow-lg`}
            >
              {inner}
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400">
                Open
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          );
        })}
      </div>
    </LogisticsShell>
  );
}
