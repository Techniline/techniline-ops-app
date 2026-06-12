"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, inputClass, tableWrap, tdCell, thCell } from "@/components/ui";
import { labelFor, LOGISTICS_STATUS } from "@/lib/logistics/constants";
import {
  fetchOrderFacets,
  fetchOrders,
  lastSyncTime,
  syncOrders,
  type OrderFilters,
  type ShopifyOrderRow,
} from "@/lib/logistics/orders";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ value }: { value: string }) {
  const label = labelFor(LOGISTICS_STATUS, value);
  const tone =
    value === "delivered" || value === "fulfilled_shopify"
      ? "bg-emerald-100 text-emerald-700"
      : value === "issue_hold" || value === "cancelled"
        ? "bg-rose-100 text-rose-700"
        : value === "ready_to_dispatch" || value === "out_for_delivery"
          ? "bg-sky-100 text-sky-700"
          : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

export default function LogisticsOrdersPage() {
  const [rows, setRows] = useState<ShopifyOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ cities: string[]; methods: string[] }>({ cities: [], methods: [] });

  const [search, setSearch] = useState("");
  const [logisticsStatus, setLogisticsStatus] = useState("");
  const [city, setCity] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters: OrderFilters = useMemo(
    () => ({
      search,
      logisticsStatus: logisticsStatus || undefined,
      city: city || undefined,
      shippingMethod: shippingMethod || undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59` : undefined,
    }),
    [search, logisticsStatus, city, shippingMethod, from, to]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchOrders(filters);
      setRows(data);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void lastSyncTime().then(setLastSync);
    void fetchOrderFacets().then(setFacets).catch(() => {});
  }, []);

  async function handleSync() {
    setSyncing(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await syncOrders();
      setMsg(`Synced ${r.ordersUpserted} order(s), ${r.itemsUpserted} item(s)${r.errors ? `, ${r.errors} error(s)` : ""}.`);
      setLastSync(r.lastSync);
      await load();
      void fetchOrderFacets().then(setFacets).catch(() => {});
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <LogisticsShell
      title="Shopify / MusicMajlis Orders"
      subtitle="Sync, track and fulfill MusicMajlis orders."
      page="orders"
      actions={
        <div className="flex items-center gap-2">
          {lastSync ? (
            <span className="text-xs text-slate-500">Last sync: {fmtDate(lastSync)}</span>
          ) : null}
          <button type="button" onClick={handleSync} disabled={syncing} className={btnPrimary}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
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

      {/* Premium search */}
      <div className="mb-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" strokeLinecap="round" />
            </svg>
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order number, customer name, mobile, email, SKU or product…"
            className={`${inputClass} h-11 w-full rounded-xl pl-9 pr-9 text-[15px]`}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          ) : null}
        </div>
        {search ? (
          <p className="mt-1 px-1 text-xs text-slate-400">
            Matching across orders and product lines. Phone matches ignore spaces and country code.
          </p>
        ) : null}
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <select value={logisticsStatus} onChange={(e) => setLogisticsStatus(e.target.value)} className={inputClass}>
          <option value="">All statuses</option>
          {LOGISTICS_STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} className={inputClass}>
          <option value="">All cities</option>
          {facets.cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)} className={inputClass}>
          <option value="">All methods</option>
          {facets.methods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className={tableWrap}>
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className={thCell}>Order</th>
              <th className={thCell}>Created</th>
              <th className={thCell}>Fulfillment</th>
              <th className={thCell}>Logistics</th>
              <th className={thCell}>Customer</th>
              <th className={thCell}>Value</th>
              <th className={thCell}>Payment</th>
              <th className={thCell}>Phone</th>
              <th className={thCell}>Method</th>
              <th className={thCell}>City</th>
              <th className={thCell}>Tracking</th>
              <th className={thCell}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={tdCell} colSpan={12}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className={tdCell} colSpan={12}>
                  No orders. Click <strong>Sync now</strong> to pull MusicMajlis orders from Shopify.
                </td>
              </tr>
            ) : (
              rows.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={tdCell}>
                    <Link href={`/logistics/orders/${o.id}`} className="font-semibold text-indigo-600 hover:underline">
                      {o.order_number ?? o.shopify_order_id}
                    </Link>
                  </td>
                  <td className={tdCell}>{fmtDate(o.shopify_created_at)}</td>
                  <td className={tdCell}>{o.fulfillment_status ?? "—"}</td>
                  <td className={tdCell}>
                    <StatusBadge value={o.logistics_status} />
                  </td>
                  <td className={tdCell}>{o.customer_name ?? "—"}</td>
                  <td className={`${tdCell} tabular-nums`}>
                    {o.order_value != null ? `${o.currency ?? "AED"} ${o.order_value.toFixed(2)}` : "—"}
                  </td>
                  <td className={tdCell}>{o.payment_method ?? "—"}</td>
                  <td className={tdCell}>{o.shipping_phone ?? "—"}</td>
                  <td className={tdCell}>{o.shipping_method ?? "—"}</td>
                  <td className={tdCell}>{o.shipping_city ?? "—"}</td>
                  <td className={tdCell}>{o.tracking_number ?? "—"}</td>
                  <td className={tdCell}>{fmtDate(o.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </LogisticsShell>
  );
}
