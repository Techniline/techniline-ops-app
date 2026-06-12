"use client";

import { useCallback, useEffect, useState } from "react";

import { btnPrimary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import {
  COURIERS,
  labelFor,
  LOGISTICS_STATUS,
  NO_TRACKING_COURIERS,
  PICKING_STATUS,
  SOURCE_LOCATIONS,
} from "@/lib/logistics/constants";
import {
  closeCancellation,
  fetchOrderDetail,
  fulfillOrder,
  parseInvoicePdf,
  saveInvoice,
  setOrderStatus,
  updateItem,
  type InvoiceResult,
  type OrderDetail,
} from "@/lib/logistics/orders";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Full order detail: customer/order panels, logistics status, packing checklist
 * and Shopify fulfillment. Self-contained (fetches by id) so it can be used on
 * the detail page or inside a modal on the orders list. `onChanged` fires after
 * any successful mutation so a parent list can refresh.
 */
export function OrderDetailView({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [notify, setNotify] = useState(true);

  // TLE invoice + cancellation closure
  const [invNo, setInvNo] = useState("");
  const [invValue, setInvValue] = useState("");
  const [invSkus, setInvSkus] = useState("");
  const [invRemarks, setInvRemarks] = useState("");
  const [mismatch, setMismatch] = useState<InvoiceResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [srt, setSrt] = useState("");
  const [prt, setPrt] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDetail(await fetchOrderDetail(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sync invoice/closure fields whenever the order reloads.
  useEffect(() => {
    if (!detail) return;
    const o = detail.order;
    setInvNo(o.tle_invoice_number ?? "");
    setInvValue(o.invoice_value != null ? String(o.invoice_value) : "");
    setInvSkus(o.invoiced_skus ?? "");
    setInvRemarks(o.invoice_remarks ?? "");
    setSrt(o.srt_number ?? "");
    setPrt(o.prt_number ?? "");
  }, [detail]);

  const allReady = !!detail && detail.items.length > 0 && detail.items.every((li) => li.picked && li.packed);
  const isPickup = NO_TRACKING_COURIERS.has(courier);
  const canFulfill = allReady && (isPickup || !!trackingNumber.trim());

  async function guarded(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadInvoice(file: File) {
    setParsing(true);
    setErr(null);
    setMsg(null);
    try {
      const d = await parseInvoicePdf(file);
      if (d.invoiceNumber) setInvNo(d.invoiceNumber);
      if (d.invoiceValue != null) setInvValue(String(d.invoiceValue));
      if (d.skus.length) setInvSkus(d.skus.join(", "));

      // Auto-match against the order immediately (before save).
      const o = detail?.order;
      const orderSkus = new Set(
        (detail?.items ?? []).map((li) => (li.sku ?? "").trim().toUpperCase()).filter(Boolean)
      );
      const invSet = new Set(d.skus.map((s) => s.trim().toUpperCase()).filter(Boolean));
      const valueMismatch =
        d.invoiceValue != null && o?.order_value != null && Math.abs(d.invoiceValue - o.order_value) > 0.01;
      const missingSkus = invSet.size ? [...orderSkus].filter((s) => !invSet.has(s)) : [];
      const extraSkus = invSet.size ? [...invSet].filter((s) => !orderSkus.has(s)) : [];
      const skuMismatch = missingSkus.length > 0 || extraSkus.length > 0;

      if (valueMismatch || skuMismatch) {
        setMismatch({ completed: false, valueMismatch, skuMismatch, missingSkus, extraSkus });
        setMsg(null);
      } else {
        setMismatch(null);
        setMsg(
          `Captured from PDF${d.engine === "basic" ? " (basic)" : ""} — matches the order. Review, then Save & verify.`
        );
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setParsing(false);
    }
  }

  async function handleSaveInvoice(orderId: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await saveInvoice({
        orderId,
        tleInvoiceNumber: invNo.trim(),
        invoiceValue: invValue ? Number(invValue) : null,
        invoicedSkus: invSkus.trim(),
        remarks: invRemarks.trim(),
      });
      if (!r.completed) {
        setMismatch(r); // mismatch detected, remarks required
      } else {
        setMismatch(r.valueMismatch || r.skuMismatch ? r : null);
        setMsg("Invoice saved.");
        await load();
        onChanged?.();
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className={`${surface} p-5 text-sm text-slate-500`}>Loading…</div>;
  }
  if (!detail) {
    return <div className={`${surface} p-5 text-sm text-slate-500`}>This order doesn&apos;t exist.</div>;
  }

  const { order, items, tracking } = detail;
  const invoiceMissing = !order.tle_invoice_number;
  const needsClosure = order.logistics_status === "cancelled" && !order.cancellation_closed;
  const remarksRequired = !!mismatch && (mismatch.valueMismatch || mismatch.skuMismatch);

  return (
    <div>
      {msg ? (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </div>
      ) : null}
      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {invoiceMissing ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          ⚠️ Missing TLE invoice — record the invoice number below before completing this order.
        </div>
      ) : null}

      {/* Cancelled order: SRT/PRT closure required (evidence logged) */}
      {needsClosure ? (
        <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30">
          <h2 className="text-sm font-semibold text-rose-800 dark:text-rose-200">
            Order cancelled — closure required
          </h2>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
            Enter the SRT and PRT document numbers to close this cancelled order. Both are
            mandatory; the closure is written to the activity log as evidence.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <input className={inputClass} placeholder="SRT number" value={srt} onChange={(e) => setSrt(e.target.value)} />
            <input className={inputClass} placeholder="PRT number" value={prt} onChange={(e) => setPrt(e.target.value)} />
            <button
              type="button"
              disabled={busy || !srt.trim() || !prt.trim()}
              onClick={() => guarded(() => closeCancellation(order.id, srt.trim(), prt.trim()), "Cancellation closed.")}
              className={`${btnPrimary} disabled:opacity-50`}
            >
              Close cancelled order
            </button>
          </div>
        </div>
      ) : null}
      {order.logistics_status === "cancelled" && order.cancellation_closed ? (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900">
          Cancelled & closed — SRT {order.srt_number ?? "—"} / PRT {order.prt_number ?? "—"}.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${surface} p-4`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Customer</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Name" value={order.customer_name} />
            <Row label="Email" value={order.email} />
            <Row label="Phone" value={order.shipping_phone} />
            <Row label="City" value={order.shipping_city} />
            <Row label="Address" value={order.delivery_address} />
          </dl>
        </div>
        <div className={`${surface} p-4`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Order</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Created" value={fmtDate(order.shopify_created_at)} />
            <Row
              label="Value"
              value={order.order_value != null ? `${order.currency ?? "AED"} ${order.order_value.toFixed(2)}` : null}
            />
            <Row label="Payment" value={order.payment_method} />
            <Row label="Shipping" value={order.shipping_method} />
            <Row label="Shopify fulfillment" value={order.fulfillment_status} />
            <Row label="Financial" value={order.financial_status} />
          </dl>
        </div>
        <div className={`${surface} p-4`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Logistics status</h2>
          <select
            value={order.logistics_status}
            disabled={busy}
            onChange={(e) => guarded(() => setOrderStatus(order.id, e.target.value), "Status updated.")}
            className={inputClass}
          >
            {LOGISTICS_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !allReady}
            title={allReady ? undefined : "All items must be picked & packed first"}
            onClick={() => guarded(() => setOrderStatus(order.id, "ready_to_dispatch"), "Marked ready to dispatch.")}
            className={`${btnPrimary} mt-2 w-full disabled:opacity-50`}
          >
            Mark Ready to Dispatch
          </button>
          {order.tracking_number ? (
            <p className="mt-2 text-xs text-slate-500">Tracking: {order.tracking_number}</p>
          ) : null}
        </div>
      </div>

      <div className={`${tableWrap} mt-4`}>
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className={thCell}>Title</th>
              <th className={thCell}>SKU</th>
              <th className={thCell}>Brand</th>
              <th className={thCell}>Qty</th>
              <th className={thCell}>Unit</th>
              <th className={thCell}>Total</th>
              <th className={thCell}>Source</th>
              <th className={thCell}>Picking</th>
              <th className={thCell}>Picked</th>
              <th className={thCell}>Packed</th>
            </tr>
          </thead>
          <tbody>
            {items.map((li) => (
              <tr key={li.id}>
                <td className={tdCell}>{li.title ?? "—"}</td>
                <td className={tdCell}>{li.sku ?? "—"}</td>
                <td className={tdCell}>{li.brand ?? "—"}</td>
                <td className={`${tdCell} tabular-nums`}>{li.qty_ordered ?? 0}</td>
                <td className={`${tdCell} tabular-nums`}>{li.unit_price != null ? li.unit_price.toFixed(2) : "—"}</td>
                <td className={`${tdCell} tabular-nums`}>{li.total_price != null ? li.total_price.toFixed(2) : "—"}</td>
                <td className={tdCell}>
                  <select
                    value={li.source_location}
                    disabled={busy}
                    onChange={(e) => guarded(() => updateItem(li.id, { source_location: e.target.value }))}
                    className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    {SOURCE_LOCATIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={tdCell}>
                  <select
                    value={li.picking_status}
                    disabled={busy}
                    onChange={(e) => guarded(() => updateItem(li.id, { picking_status: e.target.value }))}
                    className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    {PICKING_STATUS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={tdCell}>
                  <input
                    type="checkbox"
                    checked={li.picked}
                    disabled={busy}
                    onChange={(e) => guarded(() => updateItem(li.id, { picked: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </td>
                <td className={tdCell}>
                  <input
                    type="checkbox"
                    checked={li.packed}
                    disabled={busy}
                    onChange={(e) => guarded(() => updateItem(li.id, { packed: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* TLE invoice verification */}
      <div className={`${surface} mt-4 p-4`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">TLE Invoice</h2>
          <div className="flex items-center gap-2">
            <label className={`${busy || parsing ? "pointer-events-none opacity-60" : ""} cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800`}>
              {parsing ? "Reading PDF…" : "📎 Upload invoice PDF"}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={busy || parsing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadInvoice(f);
                  e.target.value = "";
                }}
              />
            </label>
            {order.invoice_verified ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                Verified
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Not verified
              </span>
            )}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input
            value={invNo}
            onChange={(e) => setInvNo(e.target.value)}
            placeholder="TLE invoice number"
            className={inputClass}
          />
          <input
            value={invValue}
            onChange={(e) => setInvValue(e.target.value)}
            type="number"
            placeholder={`Invoice value (order: ${order.order_value != null ? order.order_value.toFixed(2) : "—"})`}
            className={inputClass}
          />
          <input
            value={invSkus}
            onChange={(e) => setInvSkus(e.target.value)}
            placeholder="Invoiced SKUs (comma separated)"
            className={`${inputClass} sm:col-span-2 lg:col-span-1`}
          />
        </div>

        {mismatch && (mismatch.valueMismatch || mismatch.skuMismatch) ? (
          <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <p className="font-semibold">Mismatch detected — remarks are mandatory to complete.</p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {mismatch.valueMismatch ? (
                <li>
                  Invoice value ≠ order value ({order.order_value != null ? order.order_value.toFixed(2) : "—"}).
                </li>
              ) : null}
              {mismatch.missingSkus.length ? <li>In order but not invoiced: {mismatch.missingSkus.join(", ")}</li> : null}
              {mismatch.extraSkus.length ? <li>Invoiced but not in order: {mismatch.extraSkus.join(", ")}</li> : null}
            </ul>
          </div>
        ) : null}

        <textarea
          value={invRemarks}
          onChange={(e) => setInvRemarks(e.target.value)}
          placeholder={remarksRequired ? "Remarks (required — explain the mismatch)" : "Remarks (optional)"}
          className={`${inputClass} mt-2 h-20 ${remarksRequired && !invRemarks.trim() ? "ring-1 ring-rose-300" : ""}`}
        />
        <button
          type="button"
          disabled={busy || !invNo.trim() || (remarksRequired && !invRemarks.trim())}
          onClick={() => handleSaveInvoice(order.id)}
          className={`${btnPrimary} mt-2 disabled:opacity-50`}
        >
          {busy ? "Saving…" : order.invoice_verified ? "Update invoice" : "Save & verify invoice"}
        </button>
      </div>

      {/* Tracking & fulfillment */}
      <div className={`${surface} mt-4 p-4`}>
        <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Tracking & Shopify fulfillment</h2>
        {!allReady ? (
          <p className="mb-3 text-xs text-amber-700">
            All line items must be picked &amp; packed before you can push fulfillment.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select value={courier} onChange={(e) => setCourier(e.target.value)} className={inputClass}>
            <option value="">Courier…</option>
            {COURIERS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder={isPickup ? "Tracking number (not needed for pickup)" : "Tracking number"}
            disabled={isPickup}
            className={`${inputClass} disabled:opacity-50`}
          />
          <input
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            placeholder="Tracking URL (optional)"
            className={inputClass}
          />
          <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} className={inputClass} />
          <input
            value={deliveryNotes}
            onChange={(e) => setDeliveryNotes(e.target.value)}
            placeholder="Delivery notes (optional)"
            className={`${inputClass} sm:col-span-2 lg:col-span-1`}
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4" />
          Notify customer by email
        </label>
        <button
          type="button"
          disabled={busy || !canFulfill}
          onClick={() =>
            guarded(
              () =>
                fulfillOrder({
                  orderId: order.id,
                  courier: courier || null,
                  trackingNumber: trackingNumber.trim(),
                  trackingUrl: trackingUrl.trim() || null,
                  dispatchDate: dispatchDate || null,
                  deliveryNotes: deliveryNotes.trim() || null,
                  notify,
                }),
              isPickup ? "Marked fulfilled (In-Store Pickup) in Shopify." : "Fulfillment pushed to Shopify."
            )
          }
          className={`${btnPrimary} mt-3 disabled:opacity-50`}
        >
          {busy ? "Working…" : isPickup ? "Mark fulfilled (In-Store Pickup)" : "Fulfill & push tracking to Shopify"}
        </button>

        {tracking.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tracking history</h3>
            <ul className="space-y-1 text-sm">
              {tracking.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{labelFor(COURIERS, t.courier)}</span>
                  <span>{t.tracking_number ?? "—"}</span>
                  <span className="text-xs text-slate-500">{fmtDate(t.created_at)}</span>
                  {t.pushed_to_shopify ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      In Shopify
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {t.shopify_error ? "Push failed" : "Pending"}
                    </span>
                  )}
                  {t.shopify_error ? <span className="text-xs text-rose-600">{t.shopify_error}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900 dark:text-slate-100">{value || "—"}</dd>
    </div>
  );
}
