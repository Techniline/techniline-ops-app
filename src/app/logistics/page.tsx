"use client";

import { useEffect, useState } from "react";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { surface } from "@/components/ui";
import { fetchLogisticsKpis, type LogisticsKpis } from "@/lib/logistics/dashboard";

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
  { key: "resellerPending", label: "Reseller pending", accent: "from-fuchsia-50 to-white text-fuchsia-700" },
  { key: "cargoPending", label: "Cargo pending", accent: "from-cyan-50 to-white text-cyan-700" },
];

export default function LogisticsDashboardPage() {
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
    >
      {kpis?.notSetUp ? (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          The logistics database tables aren&apos;t created yet. Run the SQL in
          <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/60">LOGISTICS-SETUP.md</code>
          to activate this module.
        </div>
      ) : null}

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
              {loading ? "…" : (kpis?.[kpi.key] as number) ?? 0}
            </p>
          </div>
        ))}
      </div>

      <div className={`${surface} mt-6 p-5`}>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Operational queues
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Orders needing action, delayed shipments, pending PRTs, tracking-pending and
          today&apos;s dispatch lists appear here once the Shopify order flow is live
          (Phase 2). Use the <strong>Shopify / MusicMajlis Orders</strong> tab to sync and
          process orders.
        </p>
      </div>
    </LogisticsShell>
  );
}
