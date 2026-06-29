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
  validateReturn,
  type ReturnDraft,
  type ReturnType,
  type UnifiedReturn,
} from "@/lib/returns";

const EMPTY_RETURN: ReturnDraft = {
  return_type: null,
  return_date: "",
  return_id: "",
  vret_number: "",
  authorization_id: "",
  warehouse: "",
  amazon_invoice: "",
  po_number: "",
  tle_invoice_number: "",
  model_sku: "",
  qty: "",
  amount: "",
  srt_number: "",
  prt_number: "",
  dispute_id: "",
  amazon_case_id: "",
  tracking_number: "",
  comments: "",
};

function RField({ label, children, required, wide }: { label: string; children: React.ReactNode; required?: boolean; wide?: boolean }) {
  return (
    <label className={`block${wide ? " sm:col-span-2" : ""}`}>
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

function dubaiMonth(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** Parse Maricel's "Received dt" style text into structured fields. */
function parseReceivedDt(raw: string): {
  dispute_id: string; srt_number: string; prt_number: string; amazon_case_id: string; remark: string;
} {
  const s = (raw ?? "").trim();
  const out = { dispute_id: "", srt_number: "", prt_number: "", amazon_case_id: "", remark: "" };
  if (!s) return out;

  const dsptMatch = s.match(/DSPT\d+/);
  if (dsptMatch) out.dispute_id = dsptMatch[0];

  const srtMatch = s.match(/SRT\/[\d+]+/);
  if (srtMatch) out.srt_number = srtMatch[0];

  const prtMatch = s.match(/PRT\/(\d+)/);
  if (prtMatch) out.prt_number = `PRT/${prtMatch[1]}`;

  const caseMatch = s.match(/Case\s*ID#?\s*(\d+)/i);
  if (caseMatch) out.amazon_case_id = caseMatch[1];

  if (!out.dispute_id && !out.srt_number && !out.prt_number && !out.amazon_case_id) {
    out.remark = s;
  }
  return out;
}

/** One badge showing a doc reference (DSPT, SRT/PRT, Case ID). */
function RefBadge({ value, tone }: { value: string | null; tone: string }) {
  if (!value) return null;
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${tone}`}>{value}</span>;
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
    headers: [
      "Date", "Shipment Req ID", "Return ID", "Auth ID", "Invoice #",
      "Warehouse", "Model / SKU", "PO #", "ERP Invoice", "Qty", "Total Cost",
      "Type", "SRT", "PRT", "Dispute ID", "Case ID", "Tracking #", "Comment", "Source",
    ],
    rows: monthRows.map((r) => [
      formatDate(r.date), r.returnId ?? "", r.vretNumber ?? "", r.authorizationId ?? "",
      r.reference ?? "", r.warehouse ?? "", r.sku ?? "", r.poNumber ?? "", r.erpInvoice ?? "",
      r.qty != null ? String(r.qty) : "",
      r.amount != null ? formatAED(r.amount) : "",
      r.type ?? "", r.srtNumber ?? "", r.prtNumber ?? "", r.disputeId ?? "",
      r.caseId ?? "", r.trackingNumber ?? "", r.comments ?? "",
      r.source === "remittance" ? "Remittance" : "Manual",
    ]),
  }), [monthRows, month, totalValue, totalRecovered]);

  const exportCsv = () => downloadCsv(`returns-${month}.csv`, toCsv(report.headers, report.rows));
  const exportPdf = () => printReportHtml(report.title, renderTableReportHtml(report));

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
        subtitle="Amazon / marketplace returns logged manually by Maricel — auto-sync pending role approval."
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
        </div>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell}>Return date</th>
                <th className={thCell}>Shipment Req ID</th>
                <th className={thCell}>Return ID</th>
                <th className={thCell}>Auth ID</th>
                <th className={thCell}>Invoice #</th>
                <th className={thCell}>Warehouse</th>
                <th className={thCell}>Model / SKU</th>
                <th className={thCell}>PO #</th>
                <th className={thCell}>ERP Invoice</th>
                <th className={`${thCell} text-right`}>Qty</th>
                <th className={`${thCell} text-right`}>Total Cost</th>
                <th className={thCell}>Type</th>
                <th className={thCell}>Refs (SRT / PRT / Dispute)</th>
                <th className={thCell}>Tracking #</th>
                <th className={thCell}>Comment</th>
                <th className={thCell}>Source</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                  <td className={tdCell}>{formatDate(r.date)}</td>
                  <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>
                    {r.returnId ?? "—"}
                  </td>
                  <td className={`${tdCell} font-mono text-xs text-slate-500`}>{r.vretNumber ?? "—"}</td>
                  <td className={`${tdCell} font-mono text-xs text-slate-500`}>{r.authorizationId ?? "—"}</td>
                  <td className={tdCell}>{r.reference ?? "—"}</td>
                  <td className={tdCell}>
                    {r.warehouse ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {r.warehouse}
                      </span>
                    ) : "—"}
                  </td>
                  <td className={`${tdCell} font-medium`}>{r.sku ?? "—"}</td>
                  <td className={`${tdCell} font-mono text-xs`}>{r.poNumber ?? "—"}</td>
                  <td className={`${tdCell} font-mono text-xs text-slate-500`}>{r.erpInvoice ?? "—"}</td>
                  <td className={`${tdCell} text-right tabular-nums`}>{r.qty != null ? r.qty : "—"}</td>
                  <td className={`${tdCell} text-right tabular-nums font-medium`}>
                    {r.amount != null ? formatAED(r.amount) : "—"}
                  </td>
                  <td className={tdCell}>{r.type ?? "—"}</td>
                  <td className={`${tdCell} space-x-1`}>
                    <RefBadge value={r.srtNumber} tone="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" />
                    <RefBadge value={r.prtNumber} tone="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" />
                    <RefBadge value={r.disputeId} tone="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" />
                    <RefBadge value={r.caseId} tone="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" />
                  </td>
                  <td className={`${tdCell} font-mono text-xs text-slate-500`}>{r.trackingNumber ?? "—"}</td>
                  <td className={tdCell}>{r.comments ?? "—"}</td>
                  <td className={tdCell}>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.source === "remittance" ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"}`}>
                      {r.source === "remittance" ? "Remittance" : "Manual"}
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
            {/* ── Header ─────────────────────────────────────── */}
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Return header</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <RField label="Return date">
                <input type="date" className={inputClass} value={draft.return_date} onChange={(e) => setD("return_date", e.target.value)} />
              </RField>
              <RField label="Return type" required>
                <select className={inputClass} value={draft.return_type ?? ""} onChange={(e) => setD("return_type", (e.target.value || null) as ReturnType | null)}>
                  <option value="">— select —</option>
                  {RETURN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </RField>
              <RField label="Warehouse">
                <input className={inputClass} placeholder="XAEE / DXB3 / AUH1…" value={draft.warehouse} onChange={(e) => setD("warehouse", e.target.value)} />
              </RField>
              <RField label="Shipment Request ID">
                <input className={inputClass} placeholder="VRET…" value={draft.return_id} onChange={(e) => setD("return_id", e.target.value)} />
              </RField>
              <RField label="Return ID (numeric)">
                <input className={inputClass} placeholder="20022007207024" value={draft.vret_number} onChange={(e) => setD("vret_number", e.target.value)} />
              </RField>
              <RField label="Authorization ID">
                <input className={inputClass} placeholder="AMZN…" value={draft.authorization_id} onChange={(e) => setD("authorization_id", e.target.value)} />
              </RField>
            </div>

            {/* ── Item ───────────────────────────────────────── */}
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Item</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <RField label="Model / SKU">
                <input className={inputClass} value={draft.model_sku} onChange={(e) => setD("model_sku", e.target.value)} />
              </RField>
              <RField label="PO #">
                <input className={inputClass} value={draft.po_number} onChange={(e) => setD("po_number", e.target.value)} />
              </RField>
              <RField label="ERP Invoice (WS…)">
                <input className={inputClass} placeholder="WS2600202" value={draft.tle_invoice_number} onChange={(e) => setD("tle_invoice_number", e.target.value)} />
              </RField>
              <RField label="Qty">
                <input type="number" className={inputClass} value={draft.qty} onChange={(e) => setD("qty", e.target.value)} />
              </RField>
              <RField label="Total cost (AED)">
                <input type="number" step="0.01" className={inputClass} value={draft.amount} onChange={(e) => setD("amount", e.target.value)} />
              </RField>
              <RField label="Amazon invoice #">
                <input className={inputClass} placeholder="7500…" value={draft.amazon_invoice} onChange={(e) => setD("amazon_invoice", e.target.value)} />
              </RField>
            </div>

            {/* ── Documentation ──────────────────────────────── */}
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Documentation</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <RField label="SRT number">
                <input className={inputClass} placeholder="SRT/2600…" value={draft.srt_number} onChange={(e) => setD("srt_number", e.target.value)} />
              </RField>
              <RField label="PRT number">
                <input className={inputClass} placeholder="PRT/2600…" value={draft.prt_number} onChange={(e) => setD("prt_number", e.target.value)} />
              </RField>
              <RField label="Dispute ID">
                <input className={inputClass} placeholder="DSPT…" value={draft.dispute_id} onChange={(e) => setD("dispute_id", e.target.value)} />
              </RField>
              <RField label="Amazon Case ID">
                <input className={inputClass} placeholder="Case ID #…" value={draft.amazon_case_id} onChange={(e) => setD("amazon_case_id", e.target.value)} />
              </RField>
              <RField label="Tracking #">
                <input className={inputClass} value={draft.tracking_number} onChange={(e) => setD("tracking_number", e.target.value)} />
              </RField>
              <RField label="Comment / condition">
                <input className={inputClass} placeholder="GOOD PC / DEFECTIVE / NO ITEM…" value={draft.comments} onChange={(e) => setD("comments", e.target.value)} />
              </RField>
            </div>

            {addErr ? <p className="mt-2 text-xs text-red-600">{addErr}</p> : null}
            {draft.return_type && addMissing.length > 0 ? (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">Needed: {addMissing.join(", ")}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving || (!!draft.return_type && addMissing.length > 0)} className={btnPrimary}>{saving ? "Saving…" : "Save return"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

// parseReceivedDt is exported for the import helper but only used internally here.
export { parseReceivedDt };

export default function ReturnsPage() {
  return (
    <RouteGuard requireCapability="finance">
      <AppShell>
        <ReturnsContent />
      </AppShell>
    </RouteGuard>
  );
}
