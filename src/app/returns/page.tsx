"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { ImportReturnItemsModal } from "@/components/ImportReturnItemsModal";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { formatAED, formatDate } from "@/lib/format";
import { downloadCsv, printReportHtml, renderTableReportHtml, toCsv, type ReportTable } from "@/lib/export";
import {
  fetchCombinedReturns,
  logReturn,
  updateReturn,
  RETURN_TYPES,
  validateReturn,
  type ReturnDraft,
  type ReturnType,
  type UnifiedReturn,
} from "@/lib/returns";

// ── Column config ─────────────────────────────────────────────────────────────

type ColKey =
  | "date" | "returnId" | "vretNumber" | "authorizationId" | "reference"
  | "warehouse" | "sku" | "poNumber" | "erpInvoice" | "qty" | "amount"
  | "type" | "refs" | "trackingNumber" | "comments" | "source" | "status";

const COL_DEFS: { key: ColKey; label: string }[] = [
  { key: "date",            label: "Return date" },
  { key: "returnId",        label: "Shipment Req ID" },
  { key: "vretNumber",      label: "Return ID" },
  { key: "authorizationId", label: "Auth ID" },
  { key: "reference",       label: "Invoice #" },
  { key: "warehouse",       label: "Warehouse" },
  { key: "sku",             label: "Model / SKU" },
  { key: "poNumber",        label: "PO #" },
  { key: "erpInvoice",      label: "ERP Invoice" },
  { key: "qty",             label: "Qty" },
  { key: "amount",          label: "Total Cost" },
  { key: "type",            label: "Type" },
  { key: "refs",            label: "Refs" },
  { key: "trackingNumber",  label: "Tracking #" },
  { key: "comments",        label: "Comment" },
  { key: "source",          label: "Source" },
  { key: "status",          label: "Status" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_RETURN: ReturnDraft = {
  return_type: null, return_date: "", return_id: "", vret_number: "",
  authorization_id: "", warehouse: "", amazon_invoice: "", po_number: "",
  tle_invoice_number: "", model_sku: "", qty: "", amount: "",
  srt_number: "", prt_number: "", dispute_id: "", amazon_case_id: "",
  tracking_number: "", comments: "",
};

function toDraft(r: UnifiedReturn): ReturnDraft {
  return {
    return_type: r.returnType,
    return_date: r.date?.slice(0, 10) ?? "",
    return_id: r.returnId ?? "",
    vret_number: r.vretNumber ?? "",
    authorization_id: r.authorizationId ?? "",
    warehouse: r.warehouse ?? "",
    amazon_invoice: r.reference ?? "",
    po_number: r.poNumber ?? "",
    tle_invoice_number: r.erpInvoice ?? "",
    model_sku: r.sku ?? "",
    qty: r.qty != null ? String(r.qty) : "",
    amount: r.amount != null ? String(r.amount) : "",
    srt_number: r.srtNumber ?? "",
    prt_number: r.prtNumber ?? "",
    dispute_id: r.disputeId ?? "",
    amazon_case_id: r.caseId ?? "",
    tracking_number: r.trackingNumber ?? "",
    comments: r.comments ?? "",
  };
}

function RField({ label, children, required, wide }: {
  label: string; children: React.ReactNode; required?: boolean; wide?: boolean;
}) {
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
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string")
    return (error as { message: string }).message;
  return "Something went wrong.";
}

function dubaiMonth(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function RefBadge({ value, tone }: { value: string | null; tone: string }) {
  if (!value) return null;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${tone}`}>
      {value}
    </span>
  );
}

function PencilIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function ReturnsContent() {
  const { profile } = useAuth();
  const [rows, setRows]       = useState<UnifiedReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [month, setMonth]     = useState<string>(dubaiMonth());

  // modal state
  const [showAdd, setShowAdd]           = useState(false);
  const [showImportCsv, setShowImportCsv] = useState(false);
  const [editRow, setEditRow]           = useState<UnifiedReturn | null>(null);
  const [draft, setDraft]               = useState<ReturnDraft>(EMPTY_RETURN);
  const [saving, setSaving]             = useState(false);
  const [addErr, setAddErr]             = useState<string | null>(null);
  const setD = <K extends keyof ReturnDraft>(k: K, v: ReturnDraft[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));

  // search + columns
  const [search, setSearch]           = useState("");
  const [colOrder, setColOrder]       = useState<ColKey[]>(COL_DEFS.map(c => c.key));
  const [hiddenCols, setHiddenCols]   = useState<Set<ColKey>>(new Set<ColKey>(
    // Hide noisier columns by default; show status prominently
    ["authorizationId", "trackingNumber"] as ColKey[]
  ));
  const [showColPicker, setShowColPicker] = useState(false);
  const [dragCol, setDragCol]         = useState<ColKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await fetchCombinedReturns()); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const monthRows = useMemo(
    () => rows.filter((r) => (r.date ?? "").slice(0, 7) === month),
    [rows, month],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return monthRows;
    return monthRows.filter(r =>
      [r.returnId, r.vretNumber, r.sku, r.warehouse, r.poNumber, r.erpInvoice,
       r.reference, r.authorizationId, r.trackingNumber, r.comments,
       r.disputeId, r.srtNumber, r.prtNumber, r.caseId, r.type]
        .some(v => v?.toLowerCase().includes(q))
    );
  }, [monthRows, search]);

  const visibleCols = useMemo(
    () => colOrder.filter(k => !hiddenCols.has(k)).map(k => COL_DEFS.find(c => c.key === k)!),
    [colOrder, hiddenCols],
  );

  const totalValue     = monthRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalRecovered = monthRows.reduce((s, r) => s + (r.recovery ?? 0), 0);

  const report = useMemo<ReportTable>(() => ({
    title: `Returns — ${month}`,
    subtitle: `${monthRows.length} returns · value ${formatAED(totalValue)} · recovered ${formatAED(totalRecovered)}`,
    headers: ["Date","Shipment Req ID","Return ID","Auth ID","Invoice #","Warehouse","Model / SKU",
              "PO #","ERP Invoice","Qty","Total Cost","Type","SRT","PRT","Dispute ID","Case ID","Tracking #","Comment","Source"],
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

  const isEdit     = Boolean(editRow?.dbId);
  const addMissing = isEdit ? [] : validateReturn(draft);

  async function saveReturn(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!profile) return;
    setAddErr(null); setSaving(true);
    try {
      if (isEdit && editRow!.dbId) {
        await updateReturn(editRow!.dbId, draft);
      } else {
        await logReturn(draft, profile.id);
      }
      setShowAdd(false); setEditRow(null); setDraft(EMPTY_RETURN);
      await load();
    } catch (e2) {
      setAddErr(errorMessage(e2));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(r: UnifiedReturn) {
    setEditRow(r); setDraft(toDraft(r)); setAddErr(null); setShowAdd(true);
  }
  function openAdd() {
    setEditRow(null); setDraft(EMPTY_RETURN); setAddErr(null); setShowAdd(true);
  }

  function moveCol(from: ColKey, to: ColKey) {
    if (from === to) return;
    setColOrder(prev => {
      const arr = [...prev];
      const fi = arr.indexOf(from), ti = arr.indexOf(to);
      arr.splice(fi, 1); arr.splice(ti, 0, from);
      return arr;
    });
  }

  function renderCell(r: UnifiedReturn, key: ColKey): React.ReactNode {
    switch (key) {
      case "date":            return formatDate(r.date);
      case "returnId":        return <span className="font-medium text-slate-900 dark:text-slate-100">{r.returnId ?? "—"}</span>;
      case "vretNumber":      return <span className="font-mono text-xs text-slate-500">{r.vretNumber ?? "—"}</span>;
      case "authorizationId": return <span className="font-mono text-xs text-slate-500">{r.authorizationId ?? "—"}</span>;
      case "reference":       return r.reference ?? "—";
      case "warehouse":       return r.warehouse
        ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{r.warehouse}</span>
        : "—";
      case "sku":             return <span className="font-medium">{r.sku ?? "—"}</span>;
      case "poNumber":        return <span className="font-mono text-xs">{r.poNumber ?? "—"}</span>;
      case "erpInvoice":      return <span className="font-mono text-xs text-slate-500">{r.erpInvoice ?? "—"}</span>;
      case "qty":             return <span className="tabular-nums">{r.qty != null ? r.qty : "—"}</span>;
      case "amount":          return <span className="tabular-nums font-medium">{r.amount != null ? formatAED(r.amount) : "—"}</span>;
      case "type":            return r.type ?? "—";
      case "refs":            return (
        <span className="flex flex-wrap gap-1">
          <RefBadge value={r.srtNumber}  tone="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" />
          <RefBadge value={r.prtNumber}  tone="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" />
          <RefBadge value={r.disputeId}  tone="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" />
          <RefBadge value={r.caseId}     tone="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" />
        </span>
      );
      case "trackingNumber":  return <span className="font-mono text-xs text-slate-500">{r.trackingNumber ?? "—"}</span>;
      case "comments":        return r.comments ?? "—";
      case "source":          return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
          r.source === "remittance"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
            : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
        }`}>
          {r.source === "remittance" ? "Remittance" : "Manual"}
        </span>
      );
      case "status": {
        const s = r.status ?? "Open";
        const tone =
          s === "Recovered" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" :
          s === "Rejected"  ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" :
                              "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
        return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>{s}</span>;
      }
      default: return "—";
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
            <button type="button" onClick={() => setShowImportCsv(true)} className={btnSecondary}>Import CSV</button>
            <button type="button" onClick={openAdd} className={btnPrimary}>+ Add return</button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Kpi label="Returns this month" value={String(monthRows.length)} />
        <Kpi label="Total value"        value={formatAED(totalValue)}     tone="text-rose-700 dark:text-rose-400" />
        <Kpi label="Recovered"          value={formatAED(totalRecovered)} tone="text-emerald-700 dark:text-emerald-400" />
      </div>

      {/* ── Search + columns toolbar ── */}
      <div className="mb-3 flex items-center gap-2">
        <input
          type="search"
          placeholder="Search by SKU, VRET, warehouse, PO, dispute…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
        {search && (
          <span className="whitespace-nowrap text-xs text-slate-500">{filteredRows.length} / {monthRows.length}</span>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColPicker((p) => !p)}
            className={`${btnSecondary} flex items-center gap-1.5`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M5 8h6M8 12h0" />
            </svg>
            Columns
            {hiddenCols.size > 0 && (
              <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                {hiddenCols.size}
              </span>
            )}
          </button>
          {showColPicker && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Drag to reorder · check to show
              </p>
              {colOrder.map((key) => {
                const def = COL_DEFS.find(c => c.key === key)!;
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => setDragCol(key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragCol) moveCol(dragCol, key); setDragCol(null); }}
                    className={`flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${dragCol === key ? "opacity-40" : ""}`}
                  >
                    <svg className="h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 8 12" fill="currentColor">
                      <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                      <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
                      <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
                    </svg>
                    <input
                      type="checkbox"
                      className="cursor-pointer"
                      checked={!hiddenCols.has(key)}
                      onChange={(e) => {
                        setHiddenCols((prev) => {
                          const s = new Set(prev);
                          if (e.target.checked) s.delete(key); else s.add(key);
                          return s;
                        });
                      }}
                    />
                    <span className="select-none">{def.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
      ) : filteredRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">No results for &ldquo;{search}&rdquo;.</p>
          <button type="button" onClick={() => setSearch("")} className={`${btnSecondary} mt-3`}>Clear search</button>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
              <tr>
                <th className={thCell} />
                {visibleCols.map((col) => (
                  <th
                    key={col.key}
                    draggable
                    onDragStart={() => setDragCol(col.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragCol) moveCol(dragCol, col.key); setDragCol(null); }}
                    className={`${thCell} cursor-grab select-none ${dragCol === col.key ? "opacity-40" : ""}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                  <td className={`${tdCell} w-8 pr-0`}>
                    {r.dbId && (
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        title="Edit"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                      >
                        <PencilIcon />
                      </button>
                    )}
                  </td>
                  {visibleCols.map((col) => (
                    <td
                      key={col.key}
                      className={`${tdCell}${col.key === "qty" || col.key === "amount" ? " text-right" : ""}`}
                    >
                      {renderCell(r, col.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add / Edit modal ── */}
      {showAdd && (
        <Modal title={isEdit ? "Edit return" : "Add a return"} onClose={() => { setShowAdd(false); setEditRow(null); }} wide>
          <form onSubmit={saveReturn}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Return header</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <RField label="Return date">
                <input type="date" className={inputClass} value={draft.return_date} onChange={(e) => setD("return_date", e.target.value)} />
              </RField>
              <RField label="Return type" required={!isEdit}>
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
            {!isEdit && draft.return_type && addMissing.length > 0 ? (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">Needed: {addMissing.join(", ")}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowAdd(false); setEditRow(null); }} className={btnSecondary}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || (!isEdit && !!draft.return_type && addMissing.length > 0)}
                className={btnPrimary}
              >
                {saving ? "Saving…" : isEdit ? "Save changes" : "Save return"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showImportCsv && (
        <ImportReturnItemsModal
          onClose={() => setShowImportCsv(false)}
          onImported={() => { setShowImportCsv(false); void load(); }}
        />
      )}
    </div>
  );
}

export { toDraft as parseReturnDraft };

export default function ReturnsPage() {
  return (
    <RouteGuard requireCapability="finance">
      <AppShell>
        <ReturnsContent />
      </AppShell>
    </RouteGuard>
  );
}
