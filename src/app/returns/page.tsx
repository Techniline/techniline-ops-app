"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnSecondary, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { formatAED, formatDate } from "@/lib/format";
import { downloadCsv, printReportHtml, renderTableReportHtml, toCsv, type ReportTable } from "@/lib/export";
import { fetchCombinedReturns, type UnifiedReturn } from "@/lib/returns";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Something went wrong.";
}

/** Current month in Dubai (GMT+4) as YYYY-MM. */
function dubaiMonth(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function ReturnsContent() {
  const [rows, setRows] = useState<UnifiedReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(dubaiMonth());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchCombinedReturns());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const monthRows = useMemo(
    () => rows.filter((r) => (r.date ?? "").slice(0, 7) === month),
    [rows, month]
  );
  const totalValue = monthRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalRecovered = monthRows.reduce((s, r) => s + (r.recovery ?? 0), 0);

  const report = useMemo<ReportTable>(() => ({
    title: `Returns — ${month}`,
    subtitle: `${monthRows.length} returns · value ${formatAED(totalValue)} · recovered ${formatAED(totalRecovered)}`,
    headers: ["Date", "Return ID", "Type", "Ref (Invoice/PO)", "Value", "Recovered", "Status", "Source"],
    rows: monthRows.map((r) => [
      formatDate(r.date), r.returnId ?? "", r.type ?? "", r.reference ?? "",
      r.amount ?? "", r.recovery ?? "", r.status ?? "", r.source === "remittance" ? "Remittance" : "Email",
    ]),
  }), [monthRows, month, totalValue, totalRecovered]);

  const exportCsv = () => downloadCsv(`returns-${month}.csv`, toCsv(report.headers, report.rows));
  const exportPdf = () => printReportHtml(report.title, renderTableReportHtml(report));

  function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
    return (
      <div className={`${surface} p-4 text-center`}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle="Vendor returns this month — from Amazon notifications and from remittance return/dispute deductions."
        actions={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <button type="button" onClick={exportCsv} disabled={monthRows.length === 0} className={`${btnSecondary} disabled:opacity-40`}>CSV</button>
            <button type="button" onClick={exportPdf} disabled={monthRows.length === 0} className={`${btnSecondary} disabled:opacity-40`}>PDF</button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Kpi label="Returns this month" value={String(monthRows.length)} />
        <Kpi label="Total value" value={formatAED(totalValue)} tone="text-rose-700 dark:text-rose-400" />
        <Kpi label="Recovered" value={formatAED(totalRecovered)} tone="text-emerald-700 dark:text-emerald-400" />
      </div>

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading returns…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button type="button" onClick={() => void load()} className={`${btnSecondary} mt-3`}>Retry</button>
        </div>
      ) : monthRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">No returns for {month}.</p>
          <p className="mt-1 text-xs text-slate-400">
            Returns appear here from forwarded Amazon return emails and from Vendor-Return / Return-Dispute
            deductions categorised on remittances.
          </p>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell}>Date</th>
                <th className={thCell}>Return ID</th>
                <th className={thCell}>Type</th>
                <th className={thCell}>Ref (Invoice/PO)</th>
                <th className={thCell}>Value</th>
                <th className={thCell}>Recovered</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Source</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                  <td className={tdCell}>{formatDate(r.date)}</td>
                  <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>{r.returnId ?? "—"}</td>
                  <td className={tdCell}>{r.type ?? "—"}</td>
                  <td className={tdCell}>{r.reference ?? "—"}</td>
                  <td className={`${tdCell} tabular-nums`}>{r.amount != null ? formatAED(r.amount) : "—"}</td>
                  <td className={`${tdCell} tabular-nums text-emerald-700 dark:text-emerald-400`}>{r.recovery != null ? formatAED(r.recovery) : "—"}</td>
                  <td className={tdCell}>{r.status ?? "—"}</td>
                  <td className={tdCell}>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.source === "remittance" ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"}`}>
                      {r.source === "remittance" ? "Remittance" : "Email"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReturnsPage() {
  return (
    <RouteGuard requireCapability="finance">
      <AppShell>
        <ReturnsContent />
      </AppShell>
    </RouteGuard>
  );
}
