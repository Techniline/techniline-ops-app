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
  fetchDisputeItems,
  fetchDisputes,
  type Dispute,
  type DisputeItem,
} from "@/lib/disputes";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function DisputeItemsModal({
  dispute,
  onClose,
}: {
  dispute: Dispute;
  onClose: () => void;
}) {
  const [items, setItems] = useState<DisputeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const disputeNumber = dispute.dispute_number;

  const load = useCallback(async () => {
    if (!disputeNumber) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDisputeItems(disputeNumber);
      setItems(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [disputeNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal
      title={`Dispute ${dispute.dispute_number ?? dispute.id}`}
      onClose={onClose}
      wide
    >
      {loading ? (
        <p className="text-sm text-slate-500">Loading items…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button type="button" onClick={() => void load()} className={`${btnSecondary} mt-2`}>
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No related items for this dispute.
        </p>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell}>Return ID</th>
                <th className={thCell}>Line Amount</th>
                <th className={thCell}>Line Status</th>
                <th className={thCell}>Credit Amount</th>
                <th className={thCell}>Credit Ref</th>
                <th className={thCell}>Credit Date</th>
                <th className={thCell}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                >
                  <td className={`${tdCell} font-mono text-xs`}>
                    {item.return_id}
                  </td>
                  <td className={tdCell}>{formatAED(item.line_amount_aed)}</td>
                  <td className={tdCell}>
                    <StatusPill value={item.line_status} />
                  </td>
                  <td className={tdCell}>{formatAED(item.credit_amount_aed)}</td>
                  <td className={tdCell}>{item.credit_ref ?? "—"}</td>
                  <td className={tdCell}>{formatDate(item.credit_date)}</td>
                  <td className={`${tdCell} max-w-xs truncate`}>
                    {item.comment ?? "—"}
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

function DisputesContent() {
  const [rows, setRows] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Dispute | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDisputes();
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
        title="Disputes"
        subtitle="Vendor disputes and their related items (read-only)."
      />

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>
          Loading disputes…
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
          <p className="text-sm text-slate-500">No disputes found.</p>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell}>Dispute ID</th>
                <th className={thCell}>Type</th>
                <th className={thCell}>Amount</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Created Date</th>
                <th className={thCell}>Resolution Date</th>
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
                    {row.dispute_number ?? "—"}
                  </td>
                  <td className={tdCell}>{row.dispute_type ?? "—"}</td>
                  <td className={tdCell}>{formatAED(row.invoice_amount_aed)}</td>
                  <td className={tdCell}>
                    <StatusPill value={row.dispute_status} />
                  </td>
                  <td className={tdCell}>{formatDate(row.created_at)}</td>
                  <td className={tdCell}>{formatDate(row.resolved_at)}</td>
                  <td className={tdCell}>
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      disabled={!row.dispute_number}
                      className={btnSmall}
                    >
                      View items
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <DisputeItemsModal dispute={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

export default function DisputesPage() {
  return (
    <RouteGuard requireCapability="finance">
      <AppShell>
        <DisputesContent />
      </AppShell>
    </RouteGuard>
  );
}
