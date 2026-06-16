"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { isManager } from "@/lib/permissions";
import {
  fetchSellerOrderDocs,
  fetchSellerOrders,
  syncSeller,
  updateSellerOrderDoc,
  type SellerOrderDocRow,
  type SellerOrderRow,
} from "@/lib/spapi/seller";

/** Maricel owns the return documentation; managers can edit too. */
const MARICEL_UID = "227fdb27-80b5-4040-ab14-4bb945068af7";
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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const row = await updateSellerOrderDoc(order.amazon_order_id, {
        invoice_number: invoice || null,
        prt_number: prt || null,
        srt_number: srt || null,
        doc_status: status || null,
        return_note: note || null,
      });
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
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Notes</span>
            <textarea className={`${inputClass} w-full`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {err ? <div className="sm:col-span-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={saving}>Close</button>
          <button type="button" onClick={save} className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Content() {
  const { profile } = useAuth();
  const canEdit = isManager(profile) || profile?.id === MARICEL_UID;

  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [docs, setDocs] = useState<Map<string, SellerOrderDocRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [editing, setEditing] = useState<SellerOrderRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, d] = await Promise.all([fetchSellerOrders(search), fetchSellerOrderDocs()]);
      setOrders(o);
      setDocs(d);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await syncSeller();
      setMsg(`Synced ${r.orders} order(s) from Amazon.${r.warnings.length ? " Note: " + r.warnings.join("; ") : ""}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const channels = useMemo(
    () => Array.from(new Set(orders.map((o) => o.fulfillment_channel).filter(Boolean) as string[])),
    [orders]
  );
  const shown = orders.filter((o) => channel === "all" || o.fulfillment_channel === channel);

  const chip = (key: string) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      channel === key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
    }`;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">Channel:</span>
          <button type="button" onClick={() => setChannel("all")} className={chip("all")}>All</button>
          {channels.map((c) => (
            <button key={c} type="button" onClick={() => setChannel(c)} className={chip(c)}>{c}</button>
          ))}
        </div>
      ) : null}

      <div className={`${tableWrap} max-h-[72vh] overflow-auto`}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={thCell}>Order ID</th>
              <th className={thCell}>Date</th>
              <th className={thCell}>Status</th>
              <th className={thCell}>Channel</th>
              <th className={thCell}>Invoice</th>
              <th className={thCell}>PRT</th>
              <th className={thCell}>SRT</th>
              <th className={thCell}>Return status</th>
              {canEdit ? <th className={thCell}></th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className={tdCell} colSpan={canEdit ? 9 : 8}>Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td className={tdCell} colSpan={canEdit ? 9 : 8}>No Amazon orders yet — sync from the Amazon Seller Central page.</td></tr>
            ) : (
              shown.map((o) => {
                const d = docs.get(o.amazon_order_id);
                return (
                  <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className={`${tdCell} font-medium`}>{o.amazon_order_id}</td>
                    <td className={tdCell}>{fmt(o.purchase_date)}</td>
                    <td className={tdCell}>{o.order_status ?? "—"}</td>
                    <td className={tdCell}>{o.fulfillment_channel ?? "—"}</td>
                    <td className={tdCell}>{d?.invoice_number ?? "—"}</td>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Amazon Seller + Flex orders, with return paperwork (invoice / PRT / SRT) {canEdit ? "you can edit here" : "maintained by Maricel"}.
        Orders sync from the Amazon Seller Central page.
      </p>

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
