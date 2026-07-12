"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnSecondary, btnSmall, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { formatAED, formatDate } from "@/lib/format";
import { markLineSettled } from "@/lib/remittanceDeductions";
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

function SettledChip({ settledAt }: { settledAt: string | null }) {
  if (settledAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        ✓ Settled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      Pending
    </span>
  );
}

function AccountsDetailModal({
  remittance,
  onClose,
  onLinesUpdated,
}: {
  remittance: Remittance;
  onClose: () => void;
  onLinesUpdated?: () => void;
}) {
  const [lines, setLines] = useState<RemittanceLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

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

  async function toggleSettled(line: RemittanceLine) {
    setToggling(line.id);
    try {
      const nowSettled = !line.settled_at;
      await markLineSettled(line.id, nowSettled);
      setLines((prev) =>
        prev.map((l) =>
          l.id === line.id
            ? { ...l, settled_at: nowSettled ? new Date().toISOString() : null }
            : l
        )
      );
      onLinesUpdated?.();
    } catch (e) {
      alert(errorMessage(e));
    } finally {
      setToggling(null);
    }
  }

  const deductionLines = lines.filter((l) => (l.amount_paid_aed ?? 0) < 0);
  const settledCount = deductionLines.filter((l) => l.settled_at).length;
  const allSettled = deductionLines.length > 0 && settledCount === deductionLines.length;

  return (
    <Modal title={`Accounts — Remittance ${remittance.remittance_ref}`} onClose={onClose} wide>
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
          <dd className="font-medium text-rose-600 dark:text-rose-400">
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

      {remittance.reviewed_at ? (
        <p className="mb-3 text-xs text-emerald-600 dark:text-emerald-400">
          ✓ Maricel reviewed {formatDate(remittance.reviewed_at)}
        </p>
      ) : (
        <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
          ⚠ Not yet reviewed by Maricel
        </p>
      )}

      <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
        Transaction Lines
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
                <th className={thCell}>Invoice #</th>
                <th className={thCell}>Date</th>
                <th className={thCell}>Vendor Code</th>
                <th className={thCell}>Type</th>
                <th className={thCell}>Invoice Amount</th>
                <th className={thCell}>Discount Taken</th>
                <th className={thCell}>Amount Paid</th>
                <th className={thCell}>Remaining</th>
                <th className={thCell}>Maricel's Remark</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const isDeduction = (line.amount_paid_aed ?? 0) < 0;
                return (
                  <tr
                    key={line.id}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800/60 ${
                      isDeduction
                        ? "bg-rose-50/50 dark:bg-rose-950/20"
                        : ""
                    }`}
                  >
                    <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>
                      {line.invoice_number ?? "—"}
                    </td>
                    <td className={tdCell}>{formatDate(line.invoice_date)}</td>
                    <td className={`${tdCell} font-mono text-xs`}>{line.vendor_code ?? "—"}</td>
                    <td className={tdCell}>{line.transaction_type ?? "—"}</td>
                    <td className={tdCell}>{line.invoice_amount_aed != null ? formatAED(line.invoice_amount_aed) : "—"}</td>
                    <td className={tdCell}>{line.terms_discount_taken_aed != null ? formatAED(line.terms_discount_taken_aed) : "—"}</td>
                    <td
                      className={`${tdCell} font-medium ${
                        isDeduction
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-slate-900 dark:text-slate-100"
                      }`}
                    >
                      {formatAED(line.amount_paid_aed)}
                    </td>
                    <td className={tdCell}>{formatAED(line.amount_remaining_aed)}</td>
                    <td className={`${tdCell} max-w-[180px]`}>
                      {line.recon_remark ? (
                        <span className="text-slate-700 dark:text-slate-300">
                          {line.recon_remark}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">—</span>
                      )}
                    </td>
                    <td className={tdCell}>
                      <SettledChip settledAt={line.settled_at ?? null} />
                    </td>
                    <td className={tdCell}>
                      <button
                        type="button"
                        disabled={toggling === line.id}
                        onClick={() => void toggleSettled(line)}
                        className={`${btnSmall} ${
                          line.settled_at
                            ? "opacity-60 hover:opacity-100"
                            : ""
                        }`}
                      >
                        {toggling === line.id
                          ? "…"
                          : line.settled_at
                          ? "Unsettle"
                          : "Mark settled"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && deductionLines.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Deduction lines settled: <strong className="text-slate-900 dark:text-slate-100">{settledCount} / {deductionLines.length}</strong>
          </span>
          {allSettled && (
            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ All deductions settled
            </span>
          )}
        </div>
      )}
    </Modal>
  );
}

function AccountsRemittancesContent() {
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
        title="Accounts — Remittance Settlement"
        subtitle="Mark Amazon remittance lines as settled in the books. Deduction lines (red) need individual settlement."
      />

      {loading ? (
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
                <th className={thCell}>Deductions</th>
                <th className={thCell}>Net Paid</th>
                <th className={thCell}>Maricel Reviewed</th>
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
                  <td className={`${tdCell} font-medium text-rose-600 dark:text-rose-400`}>
                    {formatAED(row.deductions_aed)}
                  </td>
                  <td className={tdCell}>{formatAED(row.net_paid_aed)}</td>
                  <td className={tdCell}>
                    {row.reviewed_at ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        ✓ {formatDate(row.reviewed_at)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className={tdCell}>
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className={btnSmall}
                    >
                      Settle lines
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <AccountsDetailModal
          remittance={selected}
          onClose={() => setSelected(null)}
          onLinesUpdated={() => void load()}
        />
      ) : null}
    </div>
  );
}

export default function AccountsRemittancesPage() {
  return (
    <RouteGuard requireCapability="accounts">
      <AppShell>
        <AccountsRemittancesContent />
      </AppShell>
    </RouteGuard>
  );
}
