"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import {
  COURIERS,
  labelFor,
  LOGISTICS_STATUS,
  PICKING_STATUS,
  SOURCE_LOCATIONS,
} from "@/lib/logistics/constants";
import {
  fetchOrderDetail,
  fulfillOrder,
  setOrderStatus,
  updateItem,
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

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Tracking form
  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [notify, setNotify] = useState(true);

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

  const allReady =
    !!detail && detail.items.length > 0 && detail.items.every((li) => li.picked && li.packed);

  async function guarded(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <LogisticsShell title="Order" subtitle="Loading…">
        <div className={`${surface} p-5 text-sm text-slate-500`}>Loading…</div>
      </LogisticsShell>
    );
  }

  if (!detail) {
    return (
      <LogisticsShell title="Order not found">
        <div className={`${surface} p-5 text-sm text-slate-500`}>
          This order doesn&apos;t exist.{" "}
          <Link href="/logistics/orders" className="text-indigo-600 hover:underline">
            Back to orders
          </Link>
        </div>
      </LogisticsShell>
    );
  }

  const { order, items, tracking } = detail;

  return (
    <LogisticsShell
      title={order.order_number ?? order.shopify_order_id}
      subtitle="Order detail, picking & fulfillment."
      actions={
        <Link href="/logistics/orders" className={btnSecondary}>
          ← All orders
        </Link>
      }
    >
      {msg ? (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </div>
      ) : null}
      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Customer */}
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
        {/* Order */}
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
        {/* Logistics status */}
        <div className={`${surface} p-4`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Logistics status</h2>
          <select
            value={order.logistics_status}
            disabled={busy}
            onChange={(e) =>
              guarded(() => setOrderStatus(order.id, e.target.value), "Status updated.")
            }
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

      {/* Line items / packing checklist */}
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
            placeholder="Tracking number"
            className={inputClass}
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
          disabled={busy || !allReady || !trackingNumber.trim()}
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
              "Fulfillment pushed to Shopify."
            )
          }
          className={`${btnPrimary} mt-3 disabled:opacity-50`}
        >
          {busy ? "Working…" : "Fulfill & push tracking to Shopify"}
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
    </LogisticsShell>
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
