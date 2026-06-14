"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import {
  fetchPoRelated,
  fetchVendorPOs,
  parsePOItems,
  syncVendorPOs,
  updateVendorPO,
  vendorPoLastSync,
  type PoRelatedItem,
  type VendorPORow,
} from "@/lib/spapi/vendorOrders";

/** Internal workflow states for a PO (separate from the Amazon-side status). */
const INTERNAL_STATUSES = ["New", "Reviewed", "Booked", "Shipped", "Invoiced", "Closed", "Issue"] as const;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}
function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function StateBadge({ value }: { value: string | null }) {
  const v = (value ?? "").toLowerCase();
  const tone = v.includes("closed") || v.includes("acknowledged")
    ? "bg-emerald-100 text-emerald-700"
    : v.includes("cancel")
      ? "bg-rose-100 text-rose-700"
      : v.includes("new")
        ? "bg-sky-100 text-sky-700"
        : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{value ?? "—"}</span>;
}

const KIND_TONE: Record<PoRelatedItem["kind"], string> = {
  Return: "bg-amber-100 text-amber-700",
  Dispute: "bg-violet-100 text-violet-700",
  Shortage: "bg-orange-100 text-orange-700",
  Cancellation: "bg-rose-100 text-rose-700",
  Remittance: "bg-emerald-100 text-emerald-700",
};

function money(n: number | null, ccy: string | null): string {
  if (n == null) return "—";
  return `${ccy ? ccy + " " : ""}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** PO detail: accepted products (read-only from Amazon) + editable internal fields. */
function PoDetailModal({
  po,
  onClose,
  onSaved,
}: {
  po: VendorPORow;
  onClose: () => void;
  onSaved: (row: VendorPORow) => void;
}) {
  const items = parsePOItems(po.raw);
  const [related, setRelated] = useState<PoRelatedItem[] | null>(null);
  const [bookingDate, setBookingDate] = useState(po.booking_date ?? "");
  const [bookingRef, setBookingRef] = useState(po.booking_ref ?? "");
  const [status, setStatus] = useState(po.internal_status ?? "");
  const [invoice, setInvoice] = useState(po.invoice_number ?? "");
  const [note, setNote] = useState(po.internal_note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchPoRelated(po.po_number)
      .then((r) => { if (alive) setRelated(r); })
      .catch(() => { if (alive) setRelated([]); });
    return () => { alive = false; };
  }, [po.po_number]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const row = await updateVendorPO(po.id, {
        booking_date: bookingDate || null,
        booking_ref: bookingRef || null,
        internal_status: status || null,
        invoice_number: invoice || null,
        internal_note: note || null,
      });
      onSaved(row);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const totalCost = items.reduce(
    (sum, it) => sum + (it.unitCost ?? 0) * (it.acceptedQty ?? it.orderedQty ?? 0),
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-3xl`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">PO {po.po_number}</h2>
            <p className="text-xs text-slate-500">
              {po.po_state ?? "—"} · {po.po_type ?? "—"} · PO date {fmt(po.po_date)} · {po.item_count ?? 0} line(s)
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
          {/* Accepted products */}
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Products on this PO</h3>
          <div className={`${tableWrap} mb-5`}>
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className={thCell}>SKU</th>
                  <th className={thCell}>ASIN</th>
                  <th className={thCell}>Ordered</th>
                  <th className={thCell}>Accepted</th>
                  <th className={thCell}>Unit Cost</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td className={tdCell} colSpan={5}>No line items in the synced PO payload.</td></tr>
                ) : (
                  items.map((it, i) => (
                    <tr key={it.seq ?? i}>
                      <td className={`${tdCell} font-medium`}>{it.sku ?? "—"}</td>
                      <td className={tdCell}>{it.asin ?? "—"}</td>
                      <td className={`${tdCell} tabular-nums`}>{it.orderedQty ?? "—"}</td>
                      <td className={`${tdCell} tabular-nums`}>{it.acceptedQty ?? "—"}</td>
                      <td className={`${tdCell} tabular-nums`}>{money(it.unitCost, it.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalCost > 0 ? (
            <p className="mb-5 text-right text-sm text-slate-600 dark:text-slate-300">
              Estimated PO value: <strong>{money(totalCost, items[0]?.currency ?? null)}</strong>
            </p>
          ) : null}

          {/* Related activity across the system, keyed by PO number */}
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Related activity</h3>
          {related === null ? (
            <p className="mb-5 text-sm text-slate-400">Loading related records…</p>
          ) : related.length === 0 ? (
            <p className="mb-5 text-sm text-slate-400">No returns, disputes, shortages, cancellations or remittance deductions reference this PO.</p>
          ) : (
            <div className={`${tableWrap} mb-5`}>
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th className={thCell}>Type</th>
                    <th className={thCell}>Reference</th>
                    <th className={thCell}>Status</th>
                    <th className={thCell}>Amount (AED)</th>
                    <th className={thCell}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {related.map((it, i) => (
                    <tr key={`${it.kind}-${it.ref}-${i}`}>
                      <td className={tdCell}>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[it.kind]}`}>{it.kind}</span>
                      </td>
                      <td className={`${tdCell} font-medium`}>{it.ref}</td>
                      <td className={tdCell}>{it.status ?? "—"}</td>
                      <td className={`${tdCell} tabular-nums`}>{it.amount != null ? money(it.amount, null) : "—"}</td>
                      <td className={tdCell}>{fmt(it.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Internal fields */}
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Internal tracking</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Schedule / booking date</span>
              <input type="date" className={`${inputClass} w-full`} value={bookingDate ?? ""} onChange={(e) => setBookingDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Booking reference</span>
              <input className={`${inputClass} w-full`} value={bookingRef} onChange={(e) => setBookingRef(e.target.value)} placeholder="Appointment / slot ref" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Internal status</span>
              <select className={`${inputClass} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">—</option>
                {INTERNAL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Invoice / reference number</span>
              <input className={`${inputClass} w-full`} value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Your invoice no." />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-500">Notes</span>
              <textarea className={`${inputClass} w-full`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          {err ? <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={saving}>Close</button>
          <button type="button" onClick={save} className={btnPrimary} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Content() {
  const [rows, setRows] = useState<VendorPORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<VendorPORow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchVendorPOs(search));
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void vendorPoLastSync().then(setLastSync);
  }, []);

  async function sync() {
    setSyncing(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await syncVendorPOs();
      setMsg(`Synced ${r.upserted} purchase order(s) from Amazon Vendor.`);
      setLastSync(r.lastSync);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Amazon Vendor — Purchase Orders"
        subtitle="POs synced live from Vendor Central via SP-API."
        actions={
          <div className="flex items-center gap-2">
            {lastSync ? <span className="text-xs text-slate-500">Last sync: {fmt(lastSync)}</span> : null}
            <button type="button" onClick={sync} disabled={syncing} className={btnPrimary}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
        }
      />

      {msg ? <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}
      {err ? <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

      <input
        className={`${inputClass} mb-3 w-full`}
        placeholder="Search PO number or status…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className={`${tableWrap} max-h-[70vh] overflow-auto`}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={thCell}>PO Number</th>
              <th className={thCell}>Status</th>
              <th className={thCell}>Internal</th>
              <th className={thCell}>Type</th>
              <th className={thCell}>PO Date</th>
              <th className={thCell}>Booking</th>
              <th className={thCell}>Invoice</th>
              <th className={thCell}>Items</th>
              <th className={thCell}>Updated in Amazon</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className={tdCell} colSpan={9}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className={tdCell} colSpan={9}>No purchase orders yet — click <strong>Sync now</strong>.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={tdCell}>
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {r.po_number}
                    </button>
                  </td>
                  <td className={tdCell}><StateBadge value={r.po_state} /></td>
                  <td className={tdCell}>{r.internal_status ?? "—"}</td>
                  <td className={tdCell}>{r.po_type ?? "—"}</td>
                  <td className={tdCell}>{fmt(r.po_date)}</td>
                  <td className={tdCell}>{r.booking_date ? fmt(r.booking_date) : "—"}</td>
                  <td className={tdCell}>{r.invoice_number ?? "—"}</td>
                  <td className={`${tdCell} tabular-nums`}>{r.item_count ?? 0}</td>
                  <td className={tdCell}>{fmt(r.state_changed_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">Status mirrors Vendor Central. Auto-syncs daily; use Sync now for an immediate refresh. Click a PO number to view accepted products and record booking, status, invoice and notes.</p>

      {selected ? (
        <PoDetailModal
          po={selected}
          onClose={() => setSelected(null)}
          onSaved={(row) => {
            setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
            setSelected(null);
            setMsg(`Saved internal details for PO ${row.po_number}.`);
          }}
        />
      ) : null}
    </div>
  );
}

export default function VendorOrdersPage() {
  return (
    <RouteGuard requireCapability="finance">
      <AppShell>
        <Content />
      </AppShell>
    </RouteGuard>
  );
}
