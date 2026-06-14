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
  itemCount,
  notifyReturnLogged,
  readItems,
  rLabel,
  saveReturn,
  type ReturnFilters,
  type ReturnItem,
  type ReturnRow,
} from "@/lib/logistics/marketplace";
import { fetchSellerReturns, syncSeller, type SellerReturnRow } from "@/lib/spapi/seller";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** A displayed row — a manual marketplace return, or a read-only synced Amazon
 *  return mapped into the same shape (flagged `_synced`). */
type Row = ReturnRow & { _synced?: boolean; _syncStatus?: string | null };

function isoDate(v: string | null): string | null {
  if (!v) return null;
  return v.length > 10 ? v.slice(0, 10) : v;
}

/** Map a synced Amazon return into the marketplace-returns display shape. */
function fromSellerReturn(s: SellerReturnRow): Row {
  return {
    id: s.id,
    channel: "amazon_seller",
    return_ref: s.order_id,
    order_ref: s.order_id,
    asin: s.asin,
    sku: s.sku,
    product: s.detailed_disposition ?? null,
    qty: s.quantity,
    received_date: isoDate(s.return_date),
    reason: s.reason,
    condition: null,
    physical_status: null,
    location: null,
    doc_status: null,
    _synced: true,
    _syncStatus: s.status ?? (s.source ? s.source.toUpperCase() : null),
  } as unknown as Row;
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
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [products, setProducts] = useState<ReturnItem[]>([{ ...EMPTY_ITEM }]);
  const [busy, setBusy] = useState(false);
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
      // Manual warehouse returns + synced Amazon returns (read-only), merged into
      // one list. Synced fetch is fail-soft so the page works even before the
      // seller tables exist / sync runs.
      const manual = await fetchReturns(filters);
      let synced: Row[] = [];
      // Synced Amazon rows are channel "amazon_seller"; only show them when the
      // channel filter is unset or set to Amazon Seller, and never under
      // "Docs pending only" (they have no documentation workflow).
      const channelAllows = !channel || channel === "amazon_seller";
      if (channelAllows && !docPending) {
        try {
          synced = (await fetchSellerReturns(search)).map(fromSellerReturn);
        } catch {
          synced = [];
        }
      }
      const merged = [...manual, ...synced].sort((a, b) =>
        (b.received_date ?? "").localeCompare(a.received_date ?? "")
      );
      setRows(merged);
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [filters, channel, docPending, search]);

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

  const [syncing, setSyncing] = useState(false);
  async function syncAmazon() {
    setSyncing(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await syncSeller();
      setMsg(`Synced from Amazon — ${r.orders} order(s), ${r.returns} return(s).${r.warnings.length ? " Note: " + r.warnings.join("; ") : ""}`);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSyncing(false);
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
      subtitle="All returns by channel — manual warehouse logging (Amazon / Noon / Cocoblu) + synced Amazon returns + documentation."
      page="marketplace"
      wide
      actions={
        <div className="flex items-center gap-2">
          <button type="button" className={btnSecondary} disabled={syncing} onClick={syncAmazon}>
            {syncing ? "Syncing…" : "Sync Amazon"}
          </button>
          <button type="button" className={btnPrimary} onClick={() => openDraft({ ...EMPTY })}>
            + Log return
          </button>
        </div>
      }
    >
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

      <CustomizableTable<Row>
        viewKey="logistics_returns_view"
        rows={rows}
        loading={loading}
        emptyText="No returns logged yet."
        defaultHidden={["order", "asin", "condition", "location"]}
        columns={[
          {
            id: "channel",
            label: "Channel",
            cell: (r) => (
              <span className="flex items-center gap-1.5">
                {rLabel(CHANNELS, r.channel)}
                {r._synced ? (
                  <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">sync</span>
                ) : null}
              </span>
            ),
          },
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
          { id: "physical", label: "Physical", cell: (r) => (r._synced ? r._syncStatus ?? "—" : rLabel(PHYSICAL_STATUS, r.physical_status)) },
          { id: "location", label: "Location", cell: (r) => (r._synced ? "—" : labelFor(SOURCE_LOCATIONS, r.location)) },
          { id: "docs", label: "Docs", cell: (r) => (r._synced ? <span className="text-xs text-slate-400">—</span> : <DocBadge value={r.doc_status} />) },
          {
            id: "actions",
            label: "Actions",
            cell: (r) =>
              r._synced ? (
                <span className="whitespace-nowrap text-xs text-slate-400">Synced (read-only)</span>
              ) : (
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
