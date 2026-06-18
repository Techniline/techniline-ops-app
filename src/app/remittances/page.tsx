"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { StatusPill } from "@/components/StatusPill";
import { btnSecondary, btnSmall, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/export";
import { formatAED, formatDate } from "@/lib/format";
import {
  deductionsReport,
  fetchDeductions,
  summarizeRecovery,
  type RecoverySummary,
} from "@/lib/remittanceDeductions";
import {
  fetchRemittanceDetails,
  fetchRemittances,
  type Remittance,
  type RemittanceLine,
} from "@/lib/remittances";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function RemittanceDetailModal({
  remittance,
  onClose,
}: {
  remittance: Remittance;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<RemittanceLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRemittanceDetails(remittance.remittance_ref);
      setLines(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [remittance.remittance_ref]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title={`Remittance ${remittance.remittance_ref}`} onClose={onClose} wide>
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Payment Date</dt>
          <dd className="font-medium text-slate-900 dark:text-slate-100">
            {formatDate(remittance.payment_date)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Gross</dt>
          <dd className="font-medium text-slate-900 dark:text-slate-100">
            {formatAED(remittance.gross_amount_aed)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Deductions</dt>
          <dd className="font-medium text-slate-900 dark:text-slate-100">
            {formatAED(remittance.deductions_aed)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Net Paid</dt>
          <dd className="font-medium text-slate-900 dark:text-slate-100">
            {formatAED(remittance.net_paid_aed)}
          </dd>
        </div>
      </dl>

      <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
        Remittance Lines
      </h3>

      {loading ? (
        <p className="text-sm text-slate-500">Loading lines…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button type="button" onClick={() => void load()} className={`${btnSecondary} mt-2`}>
            Retry
          </button>
        </div>
      ) : lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No lines found for this remittance.
        </p>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell}>Invoice Number</th>
                <th className={thCell}>Invoice Date</th>
                <th className={thCell}>Type</th>
                <th className={thCell}>Invoice Amount</th>
                <th className={thCell}>Amount Paid</th>
                <th className={thCell}>Remaining</th>
                <th className={thCell}>Description</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                >
                  <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>
                    {line.invoice_number ?? "—"}
                  </td>
                  <td className={tdCell}>{formatDate(line.invoice_date)}</td>
                  <td className={tdCell}>{line.transaction_type ?? "—"}</td>
                  <td className={tdCell}>{formatAED(line.invoice_amount_aed)}</td>
                  <td className={tdCell}>{formatAED(line.amount_paid_aed)}</td>
                  <td className={tdCell}>{formatAED(line.amount_remaining_aed)}</td>
                  <td className={`${tdCell} max-w-xs truncate`}>
                    {line.description ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`${surface} p-4`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

function RecoveryTab() {
  const [sum, setSum] = useState<RecoverySummary | null>(null);
  const [report, setReport] = useState<{ headers: string[]; rows: (string | number | null)[][] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const ds = await fetchDeductions({ includeClosed: true });
        setSum(summarizeRecovery(ds));
        setReport(deductionsReport(ds));
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading recovery data…</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950">{error}</div>;
  if (!sum) return null;

  function exportCsv() {
    if (!report) return;
    downloadCsv(`remittance-deductions-${new Date().toISOString().slice(0, 10)}`, toCsv(report.headers, report.rows));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <button type="button" onClick={exportCsv} className={btnSecondary} disabled={!report || report.rows.length === 0}>
          ⤓ Export deductions CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total deducted" value={formatAED(sum.totalDeducted)} tone="text-rose-600 dark:text-rose-400" />
        <Kpi label="Total claimed" value={formatAED(sum.totalClaimed)} />
        <Kpi label="Recovered" value={formatAED(sum.totalApproved)} tone="text-emerald-600 dark:text-emerald-400" />
        <Kpi label="Recovery rate" value={sum.recoveryPct == null ? "—" : `${sum.recoveryPct}%`} tone={sum.recoveryPct != null && sum.recoveryPct >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} />
      </div>
      <p className="text-xs text-slate-400">{sum.openCount} open · {sum.closedCount} closed deductions.</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={`${surface} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">By charge type</h3>
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr><th className="px-2 py-1 text-left">Type</th><th className="px-2 py-1 text-right">#</th><th className="px-2 py-1 text-right">Deducted</th><th className="px-2 py-1 text-right">Recovered</th></tr>
            </thead>
            <tbody>
              {sum.byChargeType.map((c) => (
                <tr key={c.type} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1">{c.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.count}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-rose-600 dark:text-rose-400">{formatAED(c.deducted)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatAED(c.approved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={`${surface} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Dispute pipeline</h3>
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr><th className="px-2 py-1 text-left">Status</th><th className="px-2 py-1 text-right">#</th><th className="px-2 py-1 text-right">Claimed</th><th className="px-2 py-1 text-right">Approved</th></tr>
            </thead>
            <tbody>
              {sum.byStatus.map((s) => (
                <tr key={s.status} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1">{s.status}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{s.count}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatAED(s.claimed)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatAED(s.approved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={`${surface} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Open deductions — aging</h3>
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr><th className="px-2 py-1 text-left">Age</th><th className="px-2 py-1 text-right">#</th><th className="px-2 py-1 text-right">Amount</th></tr>
            </thead>
            <tbody>
              {sum.aging.map((a) => (
                <tr key={a.bucket} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1">{a.bucket}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{a.count}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${a.bucket === "90+ days" && a.amount > 0 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""}`}>{formatAED(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={`${surface} p-4`}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">By month</h3>
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr><th className="px-2 py-1 text-left">Month</th><th className="px-2 py-1 text-right">Deducted</th><th className="px-2 py-1 text-right">Recovered</th></tr>
            </thead>
            <tbody>
              {sum.byMonth.map((m) => (
                <tr key={m.month} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1">{m.month}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-rose-600 dark:text-rose-400">{formatAED(m.deducted)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatAED(m.approved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function RemittancesContent() {
  const [tab, setTab] = useState<"payments" | "recovery">("payments");
  const [rows, setRows] = useState<Remittance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Remittance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRemittances();
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
        title="Remittances"
        subtitle="Amazon Vendor payment remittances, deduction recovery & disputes."
      />

      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setTab("payments")} className={tab === "payments" ? btnSmall : `${btnSmall} opacity-60`}>Payments</button>
        <button type="button" onClick={() => setTab("recovery")} className={tab === "recovery" ? btnSmall : `${btnSmall} opacity-60`}>Recovery &amp; disputes</button>
      </div>

      {tab === "recovery" ? (
        <RecoveryTab />
      ) : loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>
          Loading remittances…
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
          <p className="text-sm text-slate-500">No remittances found.</p>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell}>Payment Number</th>
                <th className={thCell}>Payment Date</th>
                <th className={thCell}>Gross Amount</th>
                <th className={thCell}>Deduction Amount</th>
                <th className={thCell}>Net Payment</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30"
                >
                  <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>
                    {row.remittance_ref}
                  </td>
                  <td className={tdCell}>{formatDate(row.payment_date)}</td>
                  <td className={tdCell}>{formatAED(row.gross_amount_aed)}</td>
                  <td className={tdCell}>{formatAED(row.deductions_aed)}</td>
                  <td className={tdCell}>{formatAED(row.net_paid_aed)}</td>
                  <td className={tdCell}>
                    <StatusPill value={row.match_status} />
                  </td>
                  <td className={tdCell}>
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className={btnSmall}
                    >
                      View lines
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <RemittanceDetailModal
          remittance={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

export default function RemittancesPage() {
  return (
    <RouteGuard requireCapability="finance">
      <AppShell>
        <RemittancesContent />
      </AppShell>
    </RouteGuard>
  );
}
