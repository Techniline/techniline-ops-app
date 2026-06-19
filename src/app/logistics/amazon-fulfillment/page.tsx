"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { StatusPill, channelChipClass } from "@/components/SellerOrderUi";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { isManager } from "@/lib/permissions";
import { fetchUserNames } from "@/lib/checklist";
import {
  fetchSellerOrderDocLog,
  fetchSellerOrderDocs,
  fetchSellerOrderItems,
  fetchSellerOrders,
  fulfillmentLabel,
  importAmazonDelivery,
  importAmazonInvoices,
  needsFulfillment,
  syncSeller,
  updateSellerOrderDoc,
  type AmazonDeliveryImportSummary,
  type AmazonInvoiceImportSummary,
  type SellerOrderDocLogRow,
  type SellerOrderDocRow,
  type SellerOrderItemRow,
  type SellerOrderRow,
} from "@/lib/spapi/seller";

/** Who can edit return docs (besides managers): Maricel + Kesh. */
const DOC_EDITOR_UIDS = ["227fdb27-80b5-4040-ab14-4bb945068af7", "4f0eaff3-3ce3-44de-8ed9-aa84246fc538"];
const DOC_STATUSES = ["", "Pending", "Invoiced", "PRT raised", "SRT raised", "Closed"] as const;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function DocModal({
  order,
  doc,
  onClose,
  onSaved,
}: {
  order: SellerOrderRow;
  doc: SellerOrderDocRow | undefined;
  onClose: () => void;
  onSaved: (row: SellerOrderDocRow) => void;
}) {
  const [invoice, setInvoice] = useState(doc?.invoice_number ?? "");
  const [prt, setPrt] = useState(doc?.prt_number ?? "");
  const [srt, setSrt] = useState(doc?.srt_number ?? "");
  const [status, setStatus] = useState(doc?.doc_status ?? "");
  const [note, setNote] = useState(doc?.return_note ?? "");
  const [delivStatus, setDelivStatus] = useState(doc?.delivery_status ?? "");
  const [delivDate, setDelivDate] = useState(doc?.delivery_date ?? "");
  const [retDate, setRetDate] = useState(doc?.amazon_return_date ?? "");
  const [tracking, setTracking] = useState(doc?.tracking_number ?? "");
  const [charge, setCharge] = useState(doc?.delivery_charge != null ? String(doc.delivery_charge) : "");
  const [address, setAddress] = useState(doc?.delivery_address ?? "");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<SellerOrderDocLogRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchSellerOrderDocLog(order.amazon_order_id), fetchUserNames()]).then(([l, n]) => {
      if (alive) {
        setLog(l);
        setNames(n);
      }
    });
    return () => { alive = false; };
  }, [order.amazon_order_id]);

  async function save() {
    if (!comment.trim()) {
      setErr("Add a short comment describing this change (for the edit history).");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const row = await updateSellerOrderDoc(
        order.amazon_order_id,
        {
          invoice_number: invoice || null,
          prt_number: prt || null,
          srt_number: srt || null,
          doc_status: status || null,
          return_note: note || null,
          delivery_status: delivStatus || null,
          delivery_date: delivDate || null,
          amazon_return_date: retDate || null,
          tracking_number: tracking || null,
          delivery_charge: charge.trim() === "" ? null : Number(charge),
          delivery_address: address || null,
        },
        comment.trim()
      );
      onSaved(row);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Return documentation</h2>
            <p className="text-xs text-slate-500">Order {order.amazon_order_id} · {order.fulfillment_channel ?? "—"}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Invoice number</span>
            <input className={`${inputClass} w-full`} value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
            <select className={`${inputClass} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
              {DOC_STATUSES.map((s) => (
                <option key={s} value={s}>{s || "—"}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">PRT number</span>
            <input className={`${inputClass} w-full`} value={prt} onChange={(e) => setPrt(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">SRT number</span>
            <input className={`${inputClass} w-full`} value={srt} onChange={(e) => setSrt(e.target.value)} />
          </label>
          <div className="sm:col-span-2 mt-1 border-t border-slate-200 pt-3 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Delivery (from Amazon delivery list)</p>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Delivery status</span>
            <input className={`${inputClass} w-full`} value={delivStatus} onChange={(e) => setDelivStatus(e.target.value)} placeholder="e.g. Done" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Delivery date</span>
            <input type="date" className={`${inputClass} w-full`} value={delivDate ?? ""} onChange={(e) => setDelivDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Tracking no.</span>
            <input className={`${inputClass} w-full`} value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Delivery charge</span>
            <input className={`${inputClass} w-full`} value={charge} onChange={(e) => setCharge(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Amazon return date</span>
            <input type="date" className={`${inputClass} w-full`} value={retDate ?? ""} onChange={(e) => setRetDate(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Delivery address</span>
            <input className={`${inputClass} w-full`} value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Notes</span>
            <textarea className={`${inputClass} w-full`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Comment for this change (required)</span>
            <input className={`${inputClass} w-full`} placeholder="e.g. Added invoice INV-2601706 from ledger" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {err ? <div className="sm:col-span-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

          {log.length > 0 ? (
            <div className="sm:col-span-2">
              <p className="mb-1 text-xs font-medium text-slate-500">Edit history</p>
              <ul className="max-h-40 space-y-1.5 overflow-auto rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
                {log.map((e) => (
                  <li key={e.id} className="text-slate-600 dark:text-slate-300">
                    <span className="text-slate-400">{new Date(e.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    {" · "}
                    <span className="font-medium">{names.get(e.changed_by ?? "") ?? "—"}</span>
                    {e.comment ? <> — {e.comment}</> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={saving}>Close</button>
          <button type="button" onClick={save} className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<AmazonDeliveryImportSummary | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function run(apply: boolean) {
    if (!file) { setErr("Choose the Amazon delivery list (.xlsx) first."); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await importAmazonDelivery(file, apply);
      setSummary(r.summary);
      if (apply) { setDone(r.written ?? 0); onApplied(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const unmatchedTotal = summary ? Object.values(summary.unmatchedBySheet).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import Amazon delivery list</h2>
            <p className="text-xs text-slate-500">Backfills delivery status / dates / tracking / PRT / SRT onto matching orders. The synced order data is never changed.</p>
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
                <span className="text-slate-500">Orders in workbook</span><span className="text-right font-medium">{summary.distinctOrders}</span>
                <span className="text-slate-500">Matched to synced orders</span><span className="text-right font-medium text-emerald-600">{summary.matched}</span>
                <span className="text-slate-500">{done == null ? "Will fill" : "Filled"}</span><span className="text-right font-medium">{done ?? summary.willWrite}</span>
                <span className="text-slate-500">Unmatched (skipped)</span><span className="text-right font-medium text-amber-600">{unmatchedTotal}</span>
              </div>
              {Object.keys(summary.rowsBySheet).length ? (
                <p className="mt-2 text-xs text-slate-400">Rows by sheet: {Object.entries(summary.rowsBySheet).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
              ) : null}
              {unmatchedTotal > 0 && summary.sampleUnmatched.length ? (
                <p className="mt-1 text-xs text-slate-400">Unmatched e.g.: {summary.sampleUnmatched.slice(0, 6).join(", ")}{unmatchedTotal > 6 ? "…" : ""}</p>
              ) : null}
              {done != null ? <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ Imported {done} order(s).</p> : null}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={busy}>Close</button>
          {done == null ? (
            <>
              <button type="button" onClick={() => run(false)} className={btnSecondary} disabled={busy || !file}>{busy ? "Working…" : "Preview"}</button>
              <button type="button" onClick={() => run(true)} className={btnPrimary} disabled={busy || !summary || summary.willWrite === 0}>{busy ? "Working…" : `Apply${summary ? ` (${summary.willWrite})` : ""}`}</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InvoiceImportModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<AmazonInvoiceImportSummary | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function run(apply: boolean) {
    if (!file) { setErr("Choose the SIS ledger (.xlsx) first."); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await importAmazonInvoices(file, apply);
      setSummary(r.summary);
      if (apply) { setDone(r.filled ?? 0); onApplied(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import invoice numbers</h2>
            <p className="text-xs text-slate-500">From the SIS ledger — fills each order's invoice number (Inv No matched to the Amazon order id in Comment). Fills only where empty.</p>
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
                <span className="text-slate-500">Invoices in ledger</span><span className="text-right font-medium">{summary.distinctOrders}</span>
                <span className="text-slate-500">Matched to orders</span><span className="text-right font-medium text-emerald-600">{summary.matched}</span>
                <span className="text-slate-500">{done == null ? "Will fill" : "Filled"}</span><span className="text-right font-medium">{done ?? summary.willFill}</span>
                <span className="text-slate-500">Already had invoice</span><span className="text-right font-medium text-slate-500">{summary.alreadyHad}</span>
                <span className="text-slate-500">Unmatched (skipped)</span><span className="text-right font-medium text-amber-600">{summary.unmatched}</span>
              </div>
              {done != null ? <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ Filled {done} invoice number(s).</p> : null}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={busy}>Close</button>
          {done == null ? (
            <>
              <button type="button" onClick={() => run(false)} className={btnSecondary} disabled={busy || !file}>{busy ? "Working…" : "Preview"}</button>
              <button type="button" onClick={() => run(true)} className={btnPrimary} disabled={busy || !summary || summary.willFill === 0}>{busy ? "Working…" : `Apply${summary ? ` (${summary.willFill})` : ""}`}</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Content() {
  const { profile } = useAuth();
  const canEdit = isManager(profile) || DOC_EDITOR_UIDS.includes(profile?.id ?? "");

  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [docs, setDocs] = useState<Map<string, SellerOrderDocRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [editing, setEditing] = useState<SellerOrderRow | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingInv, setImportingInv] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Map<string, SellerOrderItemRow[] | "loading">>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const o = await fetchSellerOrders(search);
      const d = await fetchSellerOrderDocs(o.map((x) => x.amazon_order_id));
      setOrders(o);
      setDocs(d);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Wait for the auth session (profile) before fetching — otherwise the query can
  // fire before the login token attaches and come back empty (RLS sees anon).
  // Re-fetches if the profile/session changes (e.g. token refresh).
  useEffect(() => {
    if (profile?.id) void load();
  }, [load, profile?.id]);

  async function syncNow() {
    setSyncing(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await syncSeller();
      setMsg(`Synced ${r.orders} order(s) + ${r.items} invoice line item(s) from Amazon.${r.warnings.length ? " Note: " + r.warnings.slice(0, 3).join("; ") : ""}`);
      setItems(new Map()); // drop cached line items so expanded rows refetch
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function toggleItems(orderId: string) {
    if (expanded === orderId) { setExpanded(null); return; }
    setExpanded(orderId);
    if (!items.has(orderId)) {
      setItems((m) => new Map(m).set(orderId, "loading"));
      try {
        const rows = await fetchSellerOrderItems(orderId);
        setItems((m) => new Map(m).set(orderId, rows));
      } catch {
        setItems((m) => new Map(m).set(orderId, []));
      }
    }
  }

  const channels = useMemo(
    () => Array.from(new Set(orders.map(fulfillmentLabel).filter((c) => c !== "—"))),
    [orders]
  );
  const byDateDesc = (a: SellerOrderRow, b: SellerOrderRow) => (b.purchase_date ?? "").localeCompare(a.purchase_date ?? "");
  const shown = orders.filter((o) => channel === "all" || fulfillmentLabel(o) === channel);
  const unfulfilled = shown.filter(needsFulfillment).sort(byDateDesc);
  const closed = shown.filter((o) => !needsFulfillment(o)).sort(byDateDesc);
  const colSpan = canEdit ? 11 : 10;

  const head = (
    <thead className="sticky top-0 z-10">
      <tr>
        <th className={thCell}>Order ID</th>
        <th className={thCell}>Date</th>
        <th className={thCell}>Status</th>
        <th className={thCell}>Channel</th>
        <th className={thCell}>Invoice</th>
        <th className={thCell}>Delivery</th>
        <th className={thCell}>Tracking</th>
        <th className={thCell}>PRT</th>
        <th className={thCell}>SRT</th>
        <th className={thCell}>Return status</th>
        {canEdit ? <th className={thCell}></th> : null}
      </tr>
    </thead>
  );
  const rowFor = (o: SellerOrderRow) => {
    const d = docs.get(o.amazon_order_id);
    const isOpen = expanded === o.amazon_order_id;
    const its = items.get(o.amazon_order_id);
    return (
      <Fragment key={o.id}>
        <tr className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${needsFulfillment(o) ? "bg-orange-50/40 dark:bg-orange-950/10" : ""}`}>
          <td className={`${tdCell} font-medium`}>
            <button type="button" onClick={() => void toggleItems(o.amazon_order_id)} className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400" title="Show invoice line items">
              <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
              {o.amazon_order_id}
            </button>
          </td>
          <td className={tdCell}>{fmt(o.purchase_date)}</td>
          <td className={tdCell}><StatusPill order={o} /></td>
          <td className={tdCell}>{fulfillmentLabel(o)}</td>
          <td className={tdCell}>{d?.invoice_number ?? "—"}</td>
          <td className={tdCell}>
            {d?.delivery_status ? (
              <span className="whitespace-nowrap">{d.delivery_status}{d.delivery_date ? <span className="text-slate-400"> · {fmt(d.delivery_date)}</span> : null}</span>
            ) : "—"}
          </td>
          <td className={tdCell}>{d?.tracking_number ?? "—"}</td>
          <td className={tdCell}>{d?.prt_number ?? "—"}</td>
          <td className={tdCell}>{d?.srt_number ?? "—"}</td>
          <td className={tdCell}>{d?.doc_status ?? "—"}</td>
          {canEdit ? (
            <td className={tdCell}>
              <button type="button" onClick={() => setEditing(o)} className="text-indigo-600 hover:underline dark:text-indigo-400">
                {d ? "Edit" : "Add docs"}
              </button>
            </td>
          ) : null}
        </tr>
        {isOpen ? (
          <tr className="bg-slate-50/70 dark:bg-slate-900/40">
            <td className={tdCell} colSpan={colSpan}>
              {its === "loading" || its === undefined ? (
                <span className="text-xs text-slate-400">Loading line items…</span>
              ) : its.length === 0 ? (
                <span className="text-xs text-slate-400">No line items synced yet — run <strong>Sync now</strong> (Amazon backfills these in batches).</span>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="px-2 py-1 text-left font-medium">SKU</th>
                        <th className="px-2 py-1 text-left font-medium">Item</th>
                        <th className="px-2 py-1 text-right font-medium">Qty</th>
                        <th className="px-2 py-1 text-right font-medium">Price</th>
                        <th className="px-2 py-1 text-right font-medium">VAT</th>
                        <th className="px-2 py-1 text-right font-medium">Shipping</th>
                      </tr>
                    </thead>
                    <tbody>
                      {its.map((it) => (
                        <tr key={it.id} className="border-t border-slate-200/70 dark:border-slate-800">
                          <td className="px-2 py-1 font-medium">{it.seller_sku ?? "—"}</td>
                          <td className="px-2 py-1 text-slate-600 dark:text-slate-300">{it.title ?? "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{it.quantity_ordered ?? "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{it.item_price != null ? `${it.item_price.toFixed(2)} ${it.currency ?? ""}` : "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{it.item_tax != null ? it.item_tax.toFixed(2) : "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{it.shipping_price != null ? it.shipping_price.toFixed(2) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        {canEdit ? (
          <>
            <button type="button" onClick={() => setImportingInv(true)} className={btnSecondary}>
              Import invoices
            </button>
            <button type="button" onClick={() => setImporting(true)} className={btnSecondary}>
              Import delivery list
            </button>
          </>
        ) : null}
        <button type="button" onClick={syncNow} disabled={syncing} className={btnPrimary}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {msg ? <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}
      {err ? <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

      <input
        className={`${inputClass} mb-3 w-full`}
        placeholder="Search order ID, status or channel…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {channels.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">Channel:</span>
          <button type="button" onClick={() => setChannel("all")} className={channelChipClass(channel === "all", "all")}>All</button>
          {channels.map((c) => (
            <button key={c} type="button" onClick={() => setChannel(c)} className={channelChipClass(channel === c, c)}>{c}</button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className={`${surface} p-6 text-center text-sm text-slate-500`}>Loading…</div>
      ) : shown.length === 0 ? (
        <div className={`${surface} p-6 text-center text-sm text-slate-500`}>No Amazon orders yet — click <strong>Sync now</strong>.</div>
      ) : (
        <>
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <span className="inline-block h-2 w-2 rounded-full bg-orange-500" /> Needs action — unfulfilled
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300">{unfulfilled.length}</span>
            </h2>
            {unfulfilled.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing unfulfilled right now. 🎉</p>
            ) : (
              <div className={`${tableWrap} overflow-auto`}>
                <table className="min-w-full text-sm">{head}<tbody>{unfulfilled.map(rowFor)}</tbody></table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Fulfilled &amp; closed
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{closed.length}</span>
            </h2>
            <div className={`${tableWrap} max-h-[60vh] overflow-auto`}>
              <table className="min-w-full text-sm">
                {head}
                <tbody>{closed.length === 0 ? <tr><td className={tdCell} colSpan={colSpan}>None.</td></tr> : closed.map(rowFor)}</tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Amazon Seller + Flex orders, with return paperwork (invoice / PRT / SRT) {canEdit ? "you can edit here" : "maintained by Maricel"}.
      </p>

      {importing ? (
        <ImportModal onClose={() => setImporting(false)} onApplied={() => void load()} />
      ) : null}

      {importingInv ? (
        <InvoiceImportModal onClose={() => setImportingInv(false)} onApplied={() => void load()} />
      ) : null}

      {editing ? (
        <DocModal
          order={editing}
          doc={docs.get(editing.amazon_order_id)}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setDocs((prev) => new Map(prev).set(row.amazon_order_id, row));
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default function AmazonFulfillmentPage() {
  return (
    <LogisticsShell title="Amazon Fulfillment" subtitle="Amazon Seller + Flex orders and return documentation." page="amazon_fulfillment" wide>
      <Content />
    </LogisticsShell>
  );
}
