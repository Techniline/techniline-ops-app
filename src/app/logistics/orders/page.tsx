"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { OrderDetailView } from "@/components/logistics/OrderDetailView";
import { btnPrimary, btnSecondary, inputClass, tableWrap, tdCell } from "@/components/ui";
import { labelFor, LOGISTICS_STATUS } from "@/lib/logistics/constants";
import { isManager } from "@/lib/permissions";
import {
  fetchOrderFacets,
  fetchOrders,
  importLedger,
  lastSyncTime,
  loadUserView,
  saveUserView,
  setOrderStatus,
  syncOrders,
  type LedgerImportSummary,
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

interface Column {
  id: string;
  label: string;
  cell: (o: ShopifyOrderRow, open: (id: string) => void) => ReactNode;
  className?: string;
}

const COLUMNS: Column[] = [
  {
    id: "order",
    label: "Order",
    cell: (o, open) => (
      <button type="button" onClick={() => open(o.id)} className="font-semibold text-indigo-600 hover:underline">
        {o.order_number ?? o.shopify_order_id}
      </button>
    ),
  },
  { id: "created", label: "Created", cell: (o) => fmtDate(o.shopify_created_at) },
  { id: "fulfillment", label: "Fulfillment", cell: (o) => o.fulfillment_status ?? "—" },
  { id: "logistics", label: "Logistics", cell: (o) => <StatusBadge value={o.logistics_status} /> },
  { id: "customer", label: "Customer", cell: (o) => o.customer_name ?? "—" },
  {
    id: "value",
    label: "Value",
    className: "tabular-nums",
    cell: (o) => (o.order_value != null ? `${o.currency ?? "AED"} ${o.order_value.toFixed(2)}` : "—"),
  },
  { id: "payment", label: "Payment", cell: (o) => o.payment_method ?? "—" },
  { id: "phone", label: "Phone", cell: (o) => o.shipping_phone ?? "—" },
  { id: "method", label: "Method", cell: (o) => o.shipping_method ?? "—" },
  { id: "city", label: "City", cell: (o) => o.shipping_city ?? "—" },
  { id: "tracking", label: "Tracking", cell: (o) => o.tracking_number ?? "—" },
  {
    id: "invoice",
    label: "TLE Invoice",
    cell: (o) =>
      o.tle_invoice_number ? (
        <span className={o.invoice_verified ? "text-emerald-700" : "text-slate-700"}>{o.tle_invoice_number}</span>
      ) : o.logistics_status === "cancelled" ? (
        <span className="text-slate-400">—</span>
      ) : (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Missing</span>
      ),
  },
  { id: "updated", label: "Updated", cell: (o) => fmtDate(o.updated_at) },
];

const DEFAULT_ORDER = COLUMNS.map((c) => c.id);
const COL_BY_ID = new Map(COLUMNS.map((c) => [c.id, c]));

interface SavedView {
  order: string[];
  hidden: string[];
}

export default function LogisticsOrdersPage() {
  const { profile } = useAuth();
  const viewKey = `logistics.orders.view.${profile?.id ?? "anon"}`;

  const [rows, setRows] = useState<ShopifyOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ cities: string[]; methods: string[] }>({ cities: [], methods: [] });
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "board">("list");
  const [moreMenu, setMoreMenu] = useState(false);
  const dragOrderId = useRef<string | null>(null);

  // Ledger backfill (manager only)
  const [ledgerFile, setLedgerFile] = useState<File | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerImportSummary | null>(null);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const canImport = isManager(profile);

  // Column view (order + hidden), persisted per user.
  const [colOrder, setColOrder] = useState<string[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colMenu, setColMenu] = useState(false);
  const dragId = useRef<string | null>(null);

  const [search, setSearch] = useState("");
  const [logisticsStatus, setLogisticsStatus] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [city, setCity] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Apply a saved view, reconciled against the current column set (new columns
  // appear at the end, removed columns drop out).
  const applyView = useCallback((v: SavedView | null) => {
    if (!v || !Array.isArray(v.order)) return;
    const known = v.order.filter((id) => COL_BY_ID.has(id));
    const missing = DEFAULT_ORDER.filter((id) => !known.includes(id));
    setColOrder([...known, ...missing]);
    setHidden(new Set((v.hidden ?? []).filter((id) => COL_BY_ID.has(id))));
  }, []);

  // Load saved view: localStorage first (instant), then the server copy (wins,
  // so the layout follows the user across devices).
  useEffect(() => {
    if (!profile?.id) return;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(viewKey);
        if (raw) applyView(JSON.parse(raw) as SavedView);
      } catch {
        /* ignore malformed cache */
      }
    }
    void loadUserView<SavedView>("logistics_orders_view").then((v) => {
      if (v) applyView(v);
    });
  }, [profile?.id, viewKey, applyView]);

  const persist = useCallback(
    (order: string[], hide: Set<string>) => {
      const payload: SavedView = { order, hidden: [...hide] };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(viewKey, JSON.stringify(payload));
      }
      void saveUserView("logistics_orders_view", payload);
    },
    [viewKey]
  );

  const visibleColumns = useMemo(
    () => colOrder.map((id) => COL_BY_ID.get(id)).filter((c): c is Column => !!c && !hidden.has(c.id)),
    [colOrder, hidden]
  );

  const filters: OrderFilters = useMemo(
    () => ({
      search,
      logisticsStatus: logisticsStatus || undefined,
      fulfillmentStatus: fulfillmentStatus || undefined,
      city: city || undefined,
      shippingMethod: shippingMethod || undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59` : undefined,
    }),
    [search, logisticsStatus, fulfillmentStatus, city, shippingMethod, from, to]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setRows(await fetchOrders(filters));
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

  async function handleSync(since?: string) {
    setSyncing(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await syncOrders(since);
      setMsg(
        `${since ? "Historical backfill" : "Synced"}: ${r.ordersUpserted} order(s), ${r.itemsUpserted} item(s)${
          r.errors ? `, ${r.errors} error(s)` : ""
        }.`
      );
      setLastSync(r.lastSync);
      await load();
      void fetchOrderFacets().then(setFacets).catch(() => {});
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleBackfill() {
    if (
      !window.confirm(
        "Pull all MusicMajlis orders from 1 Jan 2025 to now? This is a one-time historical sync, processed month by month."
      )
    )
      return;
    setSyncing(true);
    setErr(null);
    setMsg(null);
    try {
      // Build month boundaries [2025-01-01 .. firstOfNextMonth].
      const months: { from: string; to: string }[] = [];
      const start = new Date(Date.UTC(2025, 0, 1));
      const now = new Date();
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      for (let d = start; d < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
        const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
        months.push({ from: d.toISOString().slice(0, 10), to: next.toISOString().slice(0, 10) });
      }
      let totalOrders = 0;
      let totalItems = 0;
      for (let i = 0; i < months.length; i++) {
        const m = months[i];
        setMsg(`Backfilling ${m.from.slice(0, 7)} (${i + 1}/${months.length})… ${totalOrders} orders so far.`);
        const r = await syncOrders(m.from, m.to);
        totalOrders += r.ordersUpserted;
        totalItems += r.itemsUpserted;
      }
      setMsg(`Historical backfill complete: ${totalOrders} order(s), ${totalItems} item(s).`);
      await load();
      void fetchOrderFacets().then(setFacets).catch(() => {});
    } catch (e) {
      setErr(`Backfill stopped: ${errMsg(e)} — you can click Backfill again to resume.`);
    } finally {
      setSyncing(false);
    }
  }

  async function previewLedger(file: File) {
    setLedgerBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await importLedger(file, false);
      setLedgerFile(file);
      setLedgerSummary(r.summary);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLedgerBusy(false);
    }
  }

  async function applyLedger() {
    if (!ledgerFile) return;
    setLedgerBusy(true);
    setErr(null);
    try {
      const r = await importLedger(ledgerFile, true);
      setMsg(`Backfilled ${r.filled ?? 0} invoice(s) from the ledger.`);
      setLedgerFile(null);
      setLedgerSummary(null);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLedgerBusy(false);
    }
  }

  // Board drag-and-drop: move an order card to a new logistics status.
  async function moveOrder(orderId: string, status: string) {
    const cur = rows.find((r) => r.id === orderId);
    if (!cur || cur.logistics_status === status) return;
    setErr(null);
    setMsg(null);
    try {
      await setOrderStatus(orderId, status);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  // Column drag-reorder.
  function onDrop(targetId: string) {
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === targetId) return;
    const next = colOrder.filter((id) => id !== src);
    const at = next.indexOf(targetId);
    next.splice(at, 0, src);
    setColOrder(next);
    persist(next, hidden);
  }

  function toggleColumn(id: string) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    persist(colOrder, next);
  }

  function resetView() {
    setColOrder(DEFAULT_ORDER);
    setHidden(new Set());
    persist(DEFAULT_ORDER, new Set());
    setColMenu(false);
  }

  // An order "needs action" while it isn't fulfilled in Shopify and isn't cancelled.
  const needsAction = (o: ShopifyOrderRow) =>
    o.fulfillment_status !== "fulfilled" && o.logistics_status !== "cancelled";
  const unfulfilled = rows.filter(needsAction);
  const settled = rows.filter((o) => !needsAction(o));

  function headerCell(col: Column, idx: number) {
    return (
      <th
        key={col.id}
        draggable
        onDragStart={() => (dragId.current = col.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => onDrop(col.id)}
        className={`cursor-grab select-none whitespace-nowrap border-b border-slate-200 bg-slate-100 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800 ${
          idx === 0 ? "sticky left-0 z-30" : ""
        }`}
        title="Drag to reorder"
      >
        {col.label}
      </th>
    );
  }

  function ordersTable(title: string, data: ShopifyOrderRow[], tone: "amber" | "slate") {
    return (
      <div className="mb-5">
        <div className="mb-1.5 flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${tone === "amber" ? "bg-amber-500" : "bg-slate-400"}`} />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {data.length}
          </span>
        </div>
        <div className={`${tableWrap} max-h-[58vh] overflow-auto`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-20">
              <tr>{visibleColumns.map((col, idx) => headerCell(col, idx))}</tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td className={tdCell} colSpan={visibleColumns.length || 1}>
                    None.
                  </td>
                </tr>
              ) : (
                data.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setOpenId(o.id)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    {visibleColumns.map((col, idx) => (
                      <td
                        key={col.id}
                        className={`${tdCell} whitespace-nowrap ${col.className ?? ""} ${
                          idx === 0 ? "sticky left-0 z-10 bg-white dark:bg-slate-900" : ""
                        }`}
                        onClick={col.id === "order" ? (e) => e.stopPropagation() : undefined}
                      >
                        {col.cell(o, setOpenId)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function board() {
    return (
      <div className="flex gap-3 overflow-x-auto pb-3">
        {LOGISTICS_STATUS.map((s) => {
          const cards = rows.filter((o) => o.logistics_status === s.value);
          return (
            <div
              key={s.value}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const id = dragOrderId.current;
                dragOrderId.current = null;
                if (id) void moveOrder(id, s.value);
              }}
              className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70 p-2 dark:bg-slate-800/40"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</span>
                <span className="rounded-full bg-white px-1.5 text-xs font-semibold text-slate-600 dark:bg-slate-900">
                  {cards.length}
                </span>
              </div>
              <div className="flex max-h-[64vh] flex-col gap-2 overflow-y-auto">
                {cards.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    draggable
                    onDragStart={() => (dragOrderId.current = o.id)}
                    onClick={() => setOpenId(o.id)}
                    className="cursor-grab rounded-lg border border-slate-200 bg-white p-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-indigo-600">{o.order_number ?? o.shopify_order_id}</span>
                      <span className="text-xs tabular-nums text-slate-500">
                        {o.order_value != null ? `${o.currency ?? "AED"} ${o.order_value.toFixed(0)}` : ""}
                      </span>
                    </div>
                    <div className="truncate text-sm text-slate-700 dark:text-slate-300">{o.customer_name ?? "—"}</div>
                    <div className="mt-0.5 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">{fmtDate(o.shopify_created_at)}</span>
                      {!o.tle_invoice_number && o.logistics_status !== "cancelled" ? (
                        <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                          No invoice
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <LogisticsShell
      title="Shopify / MusicMajlis Orders"
      subtitle="Sync, track and fulfill MusicMajlis orders."
      page="orders"
      wide
      actions={
        <div className="flex items-center gap-2">
          {lastSync ? <span className="text-xs text-slate-500">Last sync: {fmtDate(lastSync)}</span> : null}
          <div className="relative">
            <button type="button" onClick={() => setColMenu((v) => !v)} className={btnSecondary}>
              Columns ▾
            </button>
            {colMenu ? (
              <div className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Show columns
                </p>
                <div className="max-h-64 overflow-y-auto">
                  {colOrder.map((id) => {
                    const col = COL_BY_ID.get(id);
                    if (!col) return null;
                    return (
                      <label key={id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggleColumn(id)} className="h-4 w-4" />
                        {col.label}
                      </label>
                    );
                  })}
                </div>
                <div className="mt-1 flex justify-between border-t border-slate-100 px-1 pt-2 dark:border-slate-800">
                  <button type="button" onClick={resetView} className="text-xs text-slate-500 hover:underline">
                    Reset
                  </button>
                  <span className="text-[11px] text-slate-400">Saved automatically</span>
                </div>
              </div>
            ) : null}
          </div>
          {canImport ? (
            <div className="relative">
              <button type="button" onClick={() => setMoreMenu((v) => !v)} className={btnSecondary} aria-label="More actions">
                ⋯ More
              </button>
              {moreMenu ? (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => {
                      setMoreMenu(false);
                      void handleBackfill();
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {syncing ? "Working…" : "Backfill 2025 → now"}
                  </button>
                  <label
                    className={`${ledgerBusy ? "pointer-events-none opacity-60" : ""} block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800`}
                  >
                    {ledgerBusy ? "Reading ledger…" : "Import sales ledger…"}
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      disabled={ledgerBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        setMoreMenu(false);
                        if (f) void previewLedger(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" onClick={() => handleSync()} disabled={syncing} className={btnPrimary}>
            {syncing ? "Syncing…" : "Sync now"}
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
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select value={fulfillmentStatus} onChange={(e) => setFulfillmentStatus(e.target.value)} className={inputClass}>
          <option value="">All fulfillment</option>
          <option value="unfulfilled">Unfulfilled</option>
          <option value="partial">Partial</option>
          <option value="fulfilled">Fulfilled</option>
        </select>
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

      {/* View toggle */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition ${
                view === v
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          {rows.length} orders · {unfulfilled.length} need action
          {view === "list" ? " · drag headers to reorder · Columns ▾ to show/hide" : " · drag a card to change its status"}
        </span>
      </div>

      {loading ? (
        <div className={`${tableWrap} p-5 text-sm text-slate-500`}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className={`${tableWrap} p-5 text-sm text-slate-500`}>
          No orders. Click <strong>Sync now</strong> to pull MusicMajlis orders from Shopify.
        </div>
      ) : view === "board" ? (
        board()
      ) : (
        <>
          {ordersTable("Needs action — unfulfilled", unfulfilled, "amber")}
          {ordersTable("Fulfilled & closed", settled, "slate")}
        </>
      )}

      {/* Ledger import preview */}
      {ledgerSummary ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !ledgerBusy && setLedgerSummary(null)}>
          <div className="my-8 w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Import sales ledger — preview</h2>
            <p className="mt-1 text-sm text-slate-500">
              Backfills the TLE invoice number + value for past orders that don&apos;t have one yet,
              matched by the S-number in the ledger&apos;s Comment.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Stat label="Ledger rows" value={ledgerSummary.ledgerRows} />
              <Stat label="Orders in system" value={ledgerSummary.ordersInSystem} />
              <Stat label="Will fill" value={ledgerSummary.willFill} tone="emerald" />
              <Stat label="Already had invoice" value={ledgerSummary.alreadyHadInvoice} />
              <Stat label="Unmatched ledger rows" value={ledgerSummary.unmatchedLedger} tone="amber" />
              <Stat label="Value mismatches" value={ledgerSummary.valueMismatches} tone="rose" />
            </dl>
            {ledgerSummary.willFill === 0 ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No orders matched by S-number. Check that orders are synced and that their order number
                contains the S-number (sample unmatched: {ledgerSummary.sampleUnmatched.join(", ") || "—"}).
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Value mismatches are filled but left unverified with a remark, so they surface for review.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setLedgerSummary(null)} disabled={ledgerBusy}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={applyLedger}
                disabled={ledgerBusy || ledgerSummary.willFill === 0}
              >
                {ledgerBusy ? "Applying…" : `Backfill ${ledgerSummary.willFill} order(s)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Order detail modal */}
      {openId ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpenId(null)}>
          <div
            className="my-4 w-full max-w-5xl rounded-2xl bg-slate-50 p-4 shadow-2xl dark:bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Order detail</h2>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <OrderDetailView id={openId} onChanged={load} />
          </div>
        </div>
      ) : null}
    </LogisticsShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "rose" }) {
  const color =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "rose"
          ? "text-rose-700"
          : "text-slate-900 dark:text-slate-100";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-lg font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}
