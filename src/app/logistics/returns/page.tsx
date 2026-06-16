"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CustomizableTable } from "@/components/logistics/CustomizableTable";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import { SOURCE_LOCATIONS, labelFor } from "@/lib/logistics/constants";
import { parseDocPdf } from "@/lib/logistics/manual";
import {
  CHANNELS,
  CONDITIONS,
  DOC_STATUS,
  PHYSICAL_STATUS,
  RETURN_REASONS,
  deleteReturn,
  fetchReturns,
  importAmazonReturns,
  itemCount,
  notifyReturnLogged,
  readItems,
  rLabel,
  saveReturn,
  type ReturnFilters,
  type ReturnImportSummary,
  type ReturnItem,
  type ReturnRow,
} from "@/lib/logistics/marketplace";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function ImportReturnsModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReturnImportSummary | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function run(apply: boolean) {
    if (!file) { setErr("Choose the Amazon delivery list (.xlsx) first."); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await importAmazonReturns(file, apply);
      setSummary(r.summary);
      if (apply) { setDone(r.inserted ?? 0); onApplied(); }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import returns from delivery list</h2>
            <p className="text-xs text-slate-500">Logs return rows (return date / PRT / SRT / cancelled) channelled by sheet, as closed historical records.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); setDone(null); }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:text-slate-300 dark:file:bg-slate-800"
          />
          {err ? <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

          {summary ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="grid grid-cols-2 gap-y-1">
                <span className="text-slate-500">Return rows found</span><span className="text-right font-medium">{summary.returnRows}</span>
                <span className="text-slate-500">{done == null ? "Will log" : "Logged"}</span><span className="text-right font-medium text-emerald-600">{done ?? summary.willInsert}</span>
                <span className="text-slate-500">Already logged (skipped)</span><span className="text-right font-medium text-amber-600">{summary.alreadyExists}</span>
              </div>
              {Object.keys(summary.byChannel).length ? (
                <p className="mt-2 text-xs text-slate-400">By channel: {Object.entries(summary.byChannel).map(([k, v]) => `${rLabel(CHANNELS, k)} ${v}`).join(" · ")}</p>
              ) : null}
              {done != null ? <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ Logged {done} return(s).</p> : null}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={busy}>Close</button>
          {done == null ? (
            <>
              <button type="button" onClick={() => run(false)} className={btnSecondary} disabled={busy || !file}>{busy ? "Working…" : "Preview"}</button>
              <button type="button" onClick={() => run(true)} className={btnPrimary} disabled={busy || !summary || summary.willInsert === 0}>{busy ? "Working…" : `Apply${summary ? ` (${summary.willInsert})` : ""}`}</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Draft = Partial<ReturnRow>;
const EMPTY: Draft = { physical_status: "received", doc_status: "pending", location: "warehouse" };
const EMPTY_ITEM: ReturnItem = { sku: null, product: null, qty: 1, condition: null };
const MAX_ITEMS = 10;

function DocBadge({ value }: { value: string }) {
  const tone =
    value === "credited" || value === "closed"
      ? "bg-emerald-100 text-emerald-700"
      : value === "rejected"
        ? "bg-rose-100 text-rose-700"
        : value === "pending"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{rLabel(DOC_STATUS, value)}</span>;
}

export default function MarketplaceReturnsPage() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [products, setProducts] = useState<ReturnItem[]>([{ ...EMPTY_ITEM }]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function openDraft(d: Draft) {
    setProducts(d.id ? readItems(d as ReturnRow) : [{ ...EMPTY_ITEM }]);
    setErr(null);
    setMsg(null);
    setDraft(d);
  }
  const setItem = (i: number, k: keyof ReturnItem, v: unknown) =>
    setProducts((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const addItem = () => setProducts((ps) => (ps.length >= MAX_ITEMS ? ps : [...ps, { ...EMPTY_ITEM }]));
  const removeItem = (i: number) => setProducts((ps) => (ps.length <= 1 ? ps : ps.filter((_, idx) => idx !== i)));

  const [parsing, setParsing] = useState(false);
  async function uploadDoc(file: File) {
    setParsing(true);
    setErr(null);
    setMsg(null);
    try {
      const d = await parseDocPdf(file);
      setDraft((cur) => ({
        ...(cur ?? { ...EMPTY }),
        order_ref: cur?.order_ref || d.poNumber || d.invoiceNumber || d.doNumber || cur?.order_ref,
      }));
      if (d.items.length) {
        setProducts(d.items.map((i) => ({ sku: i.sku, product: i.description, qty: i.qty ?? 1, condition: null })).slice(0, MAX_ITEMS));
      }
      setMsg(
        d.engine === "basic"
          ? "Captured the order number from the document — add product lines manually."
          : `Captured ${d.items.length} product line(s) from the document — review and complete.`
      );
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setParsing(false);
    }
  }

  const [channel, setChannel] = useState("");
  const [docPending, setDocPending] = useState(false);
  const [search, setSearch] = useState("");

  const filters: ReturnFilters = useMemo(
    () => ({ channel: channel || undefined, docPending: docPending || undefined, search }),
    [channel, docPending, search]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchReturns(filters));
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof ReturnRow, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  async function save() {
    if (!draft) return;
    if (!draft.channel) {
      setErr("Choose a channel.");
      return;
    }
    const clean = products.filter((p) => (p.sku ?? "").trim() || (p.product ?? "").trim());
    if (clean.length === 0) {
      setErr("Add at least one product (SKU or product name).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const isNew = !draft.id;
      const totalQty = clean.reduce((s, p) => s + (Number(p.qty) || 0), 0);
      const payload: Draft = {
        ...draft,
        items: clean as unknown as Draft["items"],
        // Denormalised first line for the list columns / search / legacy.
        sku: clean[0].sku,
        product: clean[0].product,
        condition: clean[0].condition,
        qty: totalQty || clean[0].qty || 1,
      };
      const saved = await saveReturn(payload);
      if (isNew) void notifyReturnLogged(saved);
      setDraft(null);
      setMsg(isNew ? "Return logged — Maricel notified for documentation." : "Saved.");
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this return record?")) return;
    setBusy(true);
    try {
      await deleteReturn(id);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LogisticsShell
      title="Marketplace Returns"
      subtitle="Warehouse-logged returns (Amazon DF / Seller / Flex, Noon, Cocoblu) + documentation."
      page="marketplace"
      wide
      actions={
        <div className="flex items-center gap-2">
          <button type="button" className={btnSecondary} onClick={() => setImporting(true)}>
            Import from delivery list
          </button>
          <button type="button" className={btnPrimary} onClick={() => openDraft({ ...EMPTY })}>
            + Log return
          </button>
        </div>
      }
    >
      {importing ? (
        <ImportReturnsModal onClose={() => setImporting(false)} onApplied={() => void load()} />
      ) : null}

      {msg ? (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>
      ) : null}
      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {draft ? (
        <div className={`${surface} mb-4 p-4`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Warehouse / receipt (Kesh)</h2>
            <label className={`${parsing ? "pointer-events-none opacity-60" : ""} cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800`}>
              {parsing ? "Reading…" : "📎 Upload PDF (auto-fill)"}
              <input type="file" accept="application/pdf" className="hidden" disabled={parsing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadDoc(f); e.target.value = ""; }} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select className={inputClass} value={draft.channel ?? ""} onChange={(e) => set("channel", e.target.value)}>
              <option value="">Channel…</option>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input className={inputClass} placeholder="Return ID" value={draft.return_ref ?? ""} onChange={(e) => set("return_ref", e.target.value)} />
            <input className={inputClass} placeholder="Order number" value={draft.order_ref ?? ""} onChange={(e) => set("order_ref", e.target.value)} />
            <input className={inputClass} placeholder="ASIN (Amazon)" value={draft.asin ?? ""} onChange={(e) => set("asin", e.target.value)} />
            <select className={inputClass} value={draft.reason ?? ""} onChange={(e) => set("reason", e.target.value)}>
              <option value="">Reason…</option>
              {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <input className={inputClass} placeholder="Carrier" value={draft.carrier ?? ""} onChange={(e) => set("carrier", e.target.value)} />
            <input className={inputClass} placeholder="Tracking number" value={draft.tracking_number ?? ""} onChange={(e) => set("tracking_number", e.target.value)} />
            <label className="flex flex-col gap-1 text-xs text-slate-500">Return date
              <input className={inputClass} type="date" value={draft.received_date ?? ""} onChange={(e) => set("received_date", e.target.value || null)} />
            </label>
            <select className={inputClass} value={draft.physical_status ?? "received"} onChange={(e) => set("physical_status", e.target.value)}>
              {PHYSICAL_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select className={inputClass} value={draft.location ?? "warehouse"} onChange={(e) => set("location", e.target.value)}>
              {SOURCE_LOCATIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className={`${inputClass} sm:col-span-2 lg:col-span-4`} placeholder="Notes" value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>

          {/* Products — one line by default, add up to 10 */}
          <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Products ({products.length})
          </h2>
          <div className="space-y-2">
            {products.map((it, i) => (
              <div key={i} className="grid items-center gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_5rem_1fr_2rem]">
                <input className={inputClass} placeholder="SKU" value={it.sku ?? ""} onChange={(e) => setItem(i, "sku", e.target.value)} />
                <input className={inputClass} placeholder="Product" value={it.product ?? ""} onChange={(e) => setItem(i, "product", e.target.value)} />
                <input className={inputClass} type="number" placeholder="Qty" value={it.qty ?? 1} onChange={(e) => setItem(i, "qty", e.target.value ? Number(e.target.value) : 1)} />
                <select className={inputClass} value={it.condition ?? ""} onChange={(e) => setItem(i, "condition", e.target.value || null)}>
                  <option value="">Condition…</option>
                  {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <button
                  type="button"
                  title="Remove product"
                  disabled={products.length <= 1}
                  onClick={() => removeItem(i)}
                  className="rounded-md border border-slate-200 px-2 py-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:border-slate-700"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            disabled={products.length >= MAX_ITEMS}
            className={`${btnSecondary} mt-2 disabled:opacity-50`}
          >
            + Add product{products.length >= MAX_ITEMS ? " (max 10)" : ""}
          </button>

          <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Documentation (Maricel)</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select className={inputClass} value={draft.doc_status ?? "pending"} onChange={(e) => set("doc_status", e.target.value)}>
              {DOC_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className={inputClass} type="number" placeholder="Claim / credit amount" value={draft.claim_amount ?? ""} onChange={(e) => set("claim_amount", e.target.value ? Number(e.target.value) : null)} />
            <input className={inputClass} placeholder="Credit note no" value={draft.credit_note_no ?? ""} onChange={(e) => set("credit_note_no", e.target.value)} />
            <input className={inputClass} placeholder="SRT no" value={draft.srt_number ?? ""} onChange={(e) => set("srt_number", e.target.value)} />
            <input className={inputClass} placeholder="PRT no" value={draft.prt_number ?? ""} onChange={(e) => set("prt_number", e.target.value)} />
            <input className={inputClass} placeholder="Dispute ID" value={draft.dispute_id ?? ""} onChange={(e) => set("dispute_id", e.target.value)} />
            <input className={inputClass} placeholder="Case ID" value={draft.case_id ?? ""} onChange={(e) => set("case_id", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2 lg:col-span-1`} placeholder="Doc remarks" value={draft.doc_remarks ?? ""} onChange={(e) => set("doc_remarks", e.target.value)} />
          </div>

          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={btnSecondary} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input className={`${inputClass} sm:col-span-2`} placeholder="Search RMA / order / SKU / ASIN / product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={docPending} onChange={(e) => setDocPending(e.target.checked)} className="h-4 w-4" />
          Docs pending only
        </label>
      </div>

      <CustomizableTable<ReturnRow>
        viewKey="logistics_returns_view"
        rows={rows}
        loading={loading}
        emptyText="No returns logged yet."
        defaultHidden={["order", "asin", "condition", "location"]}
        columns={[
          { id: "channel", label: "Channel", cell: (r) => rLabel(CHANNELS, r.channel) },
          { id: "rma", label: "Return ID", cell: (r) => r.return_ref ?? "—" },
          { id: "order", label: "Order #", cell: (r) => r.order_ref ?? "—" },
          { id: "asin", label: "ASIN", cell: (r) => r.asin ?? "—" },
          {
            id: "sku",
            label: "SKU",
            cell: (r) => {
              const n = itemCount(r);
              return (
                <span>
                  {r.sku ?? "—"}
                  {n > 1 ? <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">+{n - 1}</span> : null}
                </span>
              );
            },
          },
          { id: "product", label: "Product", cell: (r) => (itemCount(r) > 1 ? `${r.product ?? "—"} +${itemCount(r) - 1} more` : r.product ?? "—") },
          { id: "qty", label: "Qty", className: "tabular-nums", cell: (r) => r.qty ?? 1 },
          { id: "received", label: "Return date", cell: (r) => r.received_date ?? "—" },
          { id: "condition", label: "Condition", cell: (r) => rLabel(CONDITIONS, r.condition) },
          { id: "physical", label: "Physical", cell: (r) => rLabel(PHYSICAL_STATUS, r.physical_status) },
          { id: "location", label: "Location", cell: (r) => labelFor(SOURCE_LOCATIONS, r.location) },
          { id: "docs", label: "Docs", cell: (r) => <DocBadge value={r.doc_status} /> },
          {
            id: "actions",
            label: "Actions",
            cell: (r) => (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <button type="button" className="text-indigo-600 hover:underline" onClick={() => openDraft(r)}>Edit</button>
                <button type="button" className="text-rose-600 hover:underline" onClick={() => remove(r.id)}>Delete</button>
              </div>
            ),
          },
        ]}
      />
    </LogisticsShell>
  );
}
