"use client";

import { useCallback, useEffect, useState } from "react";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { labelFor, LOGISTICS_STATUS, SOURCE_LOCATIONS } from "@/lib/logistics/constants";
import { fetchActivity, fetchApiErrors, type ActivityRow, type ApiErrorRow } from "@/lib/logistics/manual";
import { branchSupportReport, courierReport, delayReport, type BranchRow, type CourierRow, type DelayRow } from "@/lib/logistics/reports";

type Tab = "delay" | "branch" | "courier" | "activity" | "errors";

const TABS: { key: Tab; label: string }[] = [
  { key: "delay", label: "Delay Report" },
  { key: "branch", label: "Branch Support" },
  { key: "courier", label: "Courier Report" },
  { key: "activity", label: "Activity Log" },
  { key: "errors", label: "API Errors" },
];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function DeliveryReportsPage() {
  const [tab, setTab] = useState<Tab>("delay");
  const [delay, setDelay] = useState<DelayRow[]>([]);
  const [branch, setBranch] = useState<BranchRow[]>([]);
  const [courier, setCourier] = useState<CourierRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [errors, setErrors] = useState<ApiErrorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "delay") setDelay(await delayReport());
      else if (tab === "branch") setBranch(await branchSupportReport());
      else if (tab === "courier") setCourier(await courierReport());
      else if (tab === "activity") setActivity(await fetchActivity());
      else if (tab === "errors") setErrors(await fetchApiErrors());
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <LogisticsShell title="Delivery Reports" subtitle="Delay, branch support, courier and audit logs." page="reports">
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? btnPrimary : btnSecondary} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className={tableWrap}>
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Loading…</div>
        ) : tab === "delay" ? (
          <table className="min-w-full text-sm">
            <thead><tr><th className={thCell}>Order</th><th className={thCell}>Customer</th><th className={thCell}>Status</th><th className={thCell}>City</th><th className={thCell}>Created</th><th className={thCell}>Hours open</th></tr></thead>
            <tbody>
              {delay.length === 0 ? <tr><td className={tdCell} colSpan={6}>No pending orders.</td></tr> :
                delay.map((r) => (
                  <tr key={r.id} className={r.hoursOpen >= 48 ? "bg-rose-50" : r.hoursOpen >= 24 ? "bg-amber-50" : ""}>
                    <td className={tdCell}>{r.orderNumber ?? "—"}</td>
                    <td className={tdCell}>{r.customer ?? "—"}</td>
                    <td className={tdCell}>{labelFor(LOGISTICS_STATUS, r.status)}</td>
                    <td className={tdCell}>{r.city ?? "—"}</td>
                    <td className={tdCell}>{fmt(r.createdAt)}</td>
                    <td className={`${tdCell} tabular-nums font-semibold`}>{r.hoursOpen}h</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : tab === "branch" ? (
          <table className="min-w-full text-sm">
            <thead><tr><th className={thCell}>Branch</th><th className={thCell}>Total PRTs</th><th className={thCell}>Open</th><th className={thCell}>Received/Closed</th></tr></thead>
            <tbody>
              {branch.length === 0 ? <tr><td className={tdCell} colSpan={4}>No PRT data.</td></tr> :
                branch.map((r) => (
                  <tr key={r.location}>
                    <td className={tdCell}>{labelFor(SOURCE_LOCATIONS, r.location)}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.total}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.open}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.received}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : tab === "courier" ? (
          <table className="min-w-full text-sm">
            <thead><tr><th className={thCell}>Courier</th><th className={thCell}>Shipments</th><th className={thCell}>Pushed to Shopify</th><th className={thCell}>Failed pushes</th></tr></thead>
            <tbody>
              {courier.length === 0 ? <tr><td className={tdCell} colSpan={4}>No tracking data.</td></tr> :
                courier.map((r) => (
                  <tr key={r.courier}>
                    <td className={tdCell}>{r.courier}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.shipments}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.pushed}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.failed}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : tab === "activity" ? (
          <table className="min-w-full text-sm">
            <thead><tr><th className={thCell}>When</th><th className={thCell}>Order</th><th className={thCell}>Action</th><th className={thCell}>From → To</th><th className={thCell}>Notes</th></tr></thead>
            <tbody>
              {activity.length === 0 ? <tr><td className={tdCell} colSpan={5}>No activity yet.</td></tr> :
                activity.map((a) => (
                  <tr key={a.id}>
                    <td className={tdCell}>{fmt(a.created_at)}</td>
                    <td className={tdCell}>{a.order_number ?? "—"}</td>
                    <td className={tdCell}>{a.action ?? "—"}</td>
                    <td className={tdCell}>{a.old_value || a.new_value ? `${a.old_value ?? "—"} → ${a.new_value ?? "—"}` : "—"}</td>
                    <td className={tdCell}>{a.notes ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <table className="min-w-full text-sm">
            <thead><tr><th className={thCell}>When</th><th className={thCell}>Source</th><th className={thCell}>Context</th><th className={thCell}>Message</th></tr></thead>
            <tbody>
              {errors.length === 0 ? <tr><td className={tdCell} colSpan={4}>No API errors logged.</td></tr> :
                errors.map((e) => (
                  <tr key={e.id}>
                    <td className={tdCell}>{fmt(e.created_at)}</td>
                    <td className={tdCell}>{e.source ?? "—"}</td>
                    <td className={tdCell}>{e.context ?? "—"}</td>
                    <td className={`${tdCell} text-rose-600`}>{e.message ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </LogisticsShell>
  );
}
