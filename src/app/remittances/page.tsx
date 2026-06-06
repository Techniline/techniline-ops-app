"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { StatusPill } from "@/components/StatusPill";
import { btnSecondary, btnSmall, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { formatAED, formatDate } from "@/lib/format";
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

function RemittancesContent() {
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
        subtitle="Amazon payment remittances (read-only)."
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
