"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { formatAED, formatDate } from "@/lib/format";
import { downloadCsv, printReportHtml, renderTableReportHtml, toCsv, type ReportTable } from "@/lib/export";
import {
  fetchCombinedReturns,
  logReturn,
  RETURN_TYPES,
  returnFieldsFor,
  validateReturn,
  type ReturnDraft,
  type ReturnType,
  type UnifiedReturn,
} from "@/lib/returns";

const EMPTY_RETURN: ReturnDraft = {
  return_type: null, return_id: "", po_number: "", tle_invoice_number: "", model_sku: "",
  qty: "", amount: "", srt_number: "", prt_number: "", dispute_id: "", amazon_case_id: "",
  payment_number: "", comments: "",
};

function RField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
        {label}{required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

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
  const { profile } = useAuth();
  const [rows, setRows] = useState<UnifiedReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(dubaiMonth());

  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<ReturnDraft>(EMPTY_RETURN);
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const setD = <K extends keyof ReturnDraft>(k: K, v: ReturnDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

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

  const vis = returnFieldsFor(draft.return_type);
  const addMissing = validateReturn(draft);

  async function saveReturn(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!profile) return;
    setAddErr(null);
    setSaving(true);
    try {
      await logReturn(draft, profile.id);
      setShowAdd(false);
      setDraft(EMPTY_RETURN);
      await load();
    } catch (e2) {
      setAddErr(errorMessage(e2));
    } finally {
      setSaving(false);
    }
  }

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
        subtitle="Returns this month — manually logged (+ Add return) and remittance deductions categorised as return / dispute / shortage."
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
            <button type="button" onClick={() => { setDraft(EMPTY_RETURN); setAddErr(null); setShowAdd(true); }} className={btnPrimary}>+ Add return</button>
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

      {showAdd ? (
        <Modal title="Add a return" onClose={() => setShowAdd(false)} wide>
          <form onSubmit={saveReturn}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <RField label="Return type" required>
                <select className={inputClass} value={draft.return_type ?? ""} onChange={(e) => setD("return_type", (e.target.value || null) as ReturnType | null)}>
                  <option value="">— select —</option>
                  {RETURN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </RField>
              <RField label="Return ID" required={draft.return_type === "vendor_return" || draft.return_type === "return_dispute"}>
                <input className={inputClass} value={draft.return_id} onChange={(e) => setD("return_id", e.target.value)} />
              </RField>
              {vis.po ? <RField label="PO Number" required><input className={inputClass} value={draft.po_number} onChange={(e) => setD("po_number", e.target.value)} /></RField> : null}
              {vis.tle ? <RField label="TLE Invoice" required><input className={inputClass} value={draft.tle_invoice_number} onChange={(e) => setD("tle_invoice_number", e.target.value)} /></RField> : null}
              <RField label="SKU"><input className={inputClass} value={draft.model_sku} onChange={(e) => setD("model_sku", e.target.value)} /></RField>
              <RField label="Qty"><input type="number" className={inputClass} value={draft.qty} onChange={(e) => setD("qty", e.target.value)} /></RField>
              <RField label="Amount AED" required={draft.return_type === "return_dispute"}><input type="number" step="0.01" className={inputClass} value={draft.amount} onChange={(e) => setD("amount", e.target.value)} /></RField>
              {vis.dispute ? <RField label="Dispute ID" required={draft.return_type === "return_dispute"}><input className={inputClass} value={draft.dispute_id} onChange={(e) => setD("dispute_id", e.target.value)} /></RField> : null}
              {vis.caseId ? <RField label="Amazon Case ID"><input className={inputClass} value={draft.amazon_case_id} onChange={(e) => setD("amazon_case_id", e.target.value)} /></RField> : null}
              {vis.srt ? <RField label="SRT Number" required={draft.return_type === "shortage_claim" && !draft.dispute_id && !draft.amazon_case_id}><input className={inputClass} value={draft.srt_number} onChange={(e) => setD("srt_number", e.target.value)} /></RField> : null}
              {vis.prt ? <RField label="PRT Number" required={draft.return_type === "price_claim"}><input className={inputClass} value={draft.prt_number} onChange={(e) => setD("prt_number", e.target.value)} /></RField> : null}
              <RField label="Payment number"><input className={inputClass} value={draft.payment_number} onChange={(e) => setD("payment_number", e.target.value)} /></RField>
            </div>
            <div className="mt-3">
              <RField label="Remarks" required>
                <textarea className={`${inputClass} min-h-[56px]`} value={draft.comments} onChange={(e) => setD("comments", e.target.value)} placeholder="Reason / context for reconciliation" />
              </RField>
            </div>
            {addErr ? <p className="mt-2 text-xs text-red-600">{addErr}</p> : null}
            {draft.return_type && addMissing.length > 0 ? (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">Needed: {addMissing.join(", ")}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving || addMissing.length > 0} className={btnPrimary}>{saving ? "Saving…" : "Save return"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
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
