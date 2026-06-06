"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { StatusPill } from "@/components/StatusPill";
import { btnSecondary, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { formatAED, formatDate } from "@/lib/format";
import { fetchReturns, type ReturnRow } from "@/lib/returns";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function ReturnsContent() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReturns();
      setRows(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle="Vendor returns logged from Amazon notifications (read-only)."
      />

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>
          Loading returns…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button type="button" onClick={() => void load()} className={`${btnSecondary} mt-3`}>
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">No returns found.</p>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell}>Return Number</th>
                <th className={thCell}>Model / SKU</th>
                <th className={thCell}>Invoice Number</th>
                <th className={thCell}>Amount</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30"
                >
                  <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>
                    {row.return_id}
                  </td>
                  <td className={tdCell}>{row.model_sku ?? "—"}</td>
                  <td className={tdCell}>{row.tle_invoice_number ?? "—"}</td>
                  <td className={tdCell}>{formatAED(row.total_cost_aed)}</td>
                  <td className={tdCell}>
                    <StatusPill value={row.status} />
                  </td>
                  <td className={tdCell}>{formatDate(row.date_received)}</td>
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
