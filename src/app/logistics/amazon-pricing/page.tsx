"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { SkuCostsModal } from "@/components/SkuCostsModal";
import { StatusPill } from "@/components/SellerOrderUi";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { formatAED } from "@/lib/format";
import { isManager } from "@/lib/permissions";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchAllSellerItemsLite,
  fetchOrderFinance,
  fetchSellerOrders,
  fetchSkuCosts,
  fetchSkuPricing,
  fulfillmentLabel,
  syncPrices,
  syncSeller,
  type OrderFinanceRow,
  type SellerOrderRow,
  type SkuCostRow,
  type SkuPricingRow,
} from "@/lib/spapi/seller";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
const money = (n: number | null | undefined, tone = false) =>
  n == null ? <span className="text-slate-400">—</span> : <span className={tone && n < 0 ? "text-rose-600 dark:text-rose-400" : ""}>{formatAED(n)}</span>;

interface Row {
  order: SellerOrderRow;
  fin: OrderFinanceRow | undefined;
  sales: number | null; // product + shipping charged to buyer
  fees: number | null; // Amazon fees (negative)
  net: number | null; // net proceeds (deposit)
  expected: number | null; // Σ expected-in-hand × qty (null if any SKU's target missing)
  expectedComplete: boolean;
  variance: number | null; // net − expected (≥0 = at/above target; <0 = shortfall)
  pctOfTarget: number | null; // net ÷ expected × 100
  isCanceled: boolean;
  pendingSettlement: boolean; // Easy Ship fee posted but ShipmentEvent not yet settled
}

interface RepriceRow {
  sku: string;
  expected: number | null; // expected in-hand per unit
  feeRate: number; // estimated Amazon fee fraction (0..1)
  minPrice: number | null; // lowest price that still clears expected in-hand after fees
  myPrice: number | null; // current Amazon listing price
  buybox: number | null;
  isWinner: boolean | null;
  status: "below" | "ok" | "no_price" | "no_target"; // your price vs the floor
  buyboxHint: "match" | "dont_chase" | null;
  suggested: number | null; // recommended price
}

function Content() {
  const { profile } = useAuth();
  const manager = isManager(profile);

  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [finance, setFinance] = useState<Map<string, OrderFinanceRow>>(new Map());
  const [costs, setCosts] = useState<Map<string, SkuCostRow>>(new Map());
  const [itemsByOrder, setItemsByOrder] = useState<Map<string, { seller_sku: string | null; quantity_ordered: number | null }[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showCosts, setShowCosts] = useState<string | true | false>(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"orders" | "repricing">("orders");
  const [pricing, setPricing] = useState<Map<string, SkuPricingRow>>(new Map());
  const [syncingPrices, setSyncingPrices] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, fin, c, items, pr] = await Promise.all([
        fetchSellerOrders(), fetchOrderFinance(), fetchSkuCosts(), fetchAllSellerItemsLite(), fetchSkuPricing(),
      ]);
      const byOrder = new Map<string, { seller_sku: string | null; quantity_ordered: number | null }[]>();
      for (const it of items) {
        const arr = byOrder.get(it.amazon_order_id) ?? [];
        arr.push({ seller_sku: it.seller_sku, quantity_ordered: it.quantity_ordered });
        byOrder.set(it.amazon_order_id, arr);
      }
      setOrders(o); setFinance(fin); setCosts(c); setItemsByOrder(byOrder); setPricing(pr); setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile?.id) void load(); }, [load, profile?.id]);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e) => {
      if (e === "SIGNED_IN" || e === "TOKEN_REFRESHED" || e === "INITIAL_SESSION") void load();
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  // Sum of expected in-hand (target net per unit × qty) for an order.
  const orderExpected = useCallback((orderId: string): { expected: number | null; complete: boolean } => {
    const items = itemsByOrder.get(orderId);
    if (!items || items.length === 0) return { expected: null, complete: false };
    let sum = 0; let complete = true;
    for (const it of items) {
      const e = it.seller_sku ? costs.get(it.seller_sku)?.expected_in_hand : null;
      if (e == null) { complete = false; continue; }
      sum += e * (it.quantity_ordered && it.quantity_ordered > 0 ? it.quantity_ordered : 1);
    }
    return { expected: Math.round(sum * 100) / 100, complete };
  }, [itemsByOrder, costs]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const order of orders) {
      const fin = finance.get(order.amazon_order_id);
      const isCanceled = (order.order_status ?? "").toLowerCase().includes("cancel");
      if (!fin) {
        // Canceled orders without financials: show in table with blank columns + Canceled pill.
        if (isCanceled) {
          out.push({ order, fin: undefined, sales: null, fees: null, net: null, expected: null, expectedComplete: false, variance: null, pctOfTarget: null, isCanceled: true, pendingSettlement: false });
        }
        continue;
      }
      const sales = (fin.product_charges ?? 0) + (fin.shipping_charges ?? 0);
      const net = fin.net_proceeds ?? null;
      const { expected, complete } = orderExpected(order.amazon_order_id);
      const variance = net != null && complete && expected != null ? Math.round((net - expected) * 100) / 100 : null;
      const pctOfTarget = net != null && complete && expected != null && expected !== 0 ? Math.round((net / expected) * 1000) / 10 : null;
      // pendingSettlement: Easy Ship ServiceFeeEvent already billed but the ShipmentEvent
      // (product sale + referral fee) hasn't posted in the Finances API yet.
      // Guard on !posted_date: a fully-refunded order also has sales=0 but IS settled
      // (posted_date comes from the ShipmentEvent/RefundEvent).
      const pendingSettlement = sales === 0 && (order.order_total ?? 0) > 0 && !fin.posted_date;
      out.push({ order, fin, sales, fees: fin.fees_total ?? null, net, expected: complete ? expected : null, expectedComplete: complete, variance, pctOfTarget, isCanceled: false, pendingSettlement });
    }
    return out.sort((a, b) => {
      if (a.isCanceled !== b.isCanceled) return a.isCanceled ? 1 : -1;
      return (b.fin?.posted_date ?? b.order.purchase_date ?? "").localeCompare(a.fin?.posted_date ?? a.order.purchase_date ?? "");
    });
  }, [orders, finance, orderExpected]);

  // Settlement coverage — why some orders have no financials yet.
  const coverage = useMemo(() => {
    let settled = 0, awaiting = 0, canceled = 0, pending = 0, other = 0;
    for (const o of orders) {
      if (finance.has(o.amazon_order_id)) { settled += 1; continue; }
      const st = o.order_status ?? "";
      if (st.toLowerCase().includes("cancel")) canceled += 1;
      else if (st === "Shipped") awaiting += 1;
      else if (st === "Unshipped" || st === "Pending") pending += 1;
      else other += 1;
    }
    const list = [
      { label: "Shipped — settled", count: settled, fin: "✅ shown in table" },
      { label: "Canceled", count: canceled, fin: "✅ shown in table (no money moved)" },
      { label: "Shipped — awaiting settlement", count: awaiting, fin: "⏳ fills in within a day or two" },
      { label: "Unshipped / Pending", count: pending, fin: "⏳ until shipped & settled" },
    ];
    if (other > 0) list.push({ label: "Other", count: other, fin: "—" });
    return list.filter((r) => r.count > 0);
  }, [orders, finance]);

  const displayRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.order.amazon_order_id.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const shortCount = rows.filter((r) => !r.isCanceled && r.variance != null && r.variance < 0).length;
  const noTargetCount = rows.filter((r) => !r.isCanceled && !r.expectedComplete).length;
  const totals = useMemo(() => {
    const settled = rows.filter((r) => !r.isCanceled);
    const withVar = settled.filter((r) => r.variance != null);
    return {
      net: settled.reduce((s, r) => s + (r.net ?? 0), 0),
      fees: settled.reduce((s, r) => s + (r.fees ?? 0), 0),
      expected: withVar.reduce((s, r) => s + (r.expected ?? 0), 0),
      variance: withVar.reduce((s, r) => s + (r.variance ?? 0), 0),
    };
  }, [rows]);

  // ── Repricing (per-SKU) ────────────────────────────────────────────────────
  // Average realized Amazon fee fraction across settled orders (fallback 15%).
  const globalFeeRate = useMemo(() => {
    let sum = 0, n = 0;
    for (const fin of finance.values()) {
      const sales = (fin.product_charges ?? 0) + (fin.shipping_charges ?? 0);
      if (sales > 0 && fin.net_proceeds != null) { sum += 1 - fin.net_proceeds / sales; n += 1; }
    }
    return n ? sum / n : 0.15;
  }, [finance]);

  // Per-SKU fee fraction from settled single-SKU orders (clean attribution).
  const skuFeeRate = useMemo(() => {
    const acc = new Map<string, { s: number; n: number }>();
    for (const [oid, items] of itemsByOrder) {
      const fin = finance.get(oid); if (!fin || fin.net_proceeds == null) continue;
      const distinct = [...new Set(items.map((i) => i.seller_sku).filter(Boolean))];
      if (distinct.length !== 1) continue;
      const sales = (fin.product_charges ?? 0) + (fin.shipping_charges ?? 0);
      if (sales <= 0) continue;
      const a = acc.get(distinct[0] as string) ?? { s: 0, n: 0 };
      a.s += 1 - fin.net_proceeds / sales; a.n += 1; acc.set(distinct[0] as string, a);
    }
    const m = new Map<string, number>();
    for (const [sku, a] of acc) m.set(sku, a.s / a.n);
    return m;
  }, [itemsByOrder, finance]);

  const repriceRows: RepriceRow[] = useMemo(() => {
    const rank = { below: 0, no_price: 1, ok: 2, no_target: 3 } as const;
    const out: RepriceRow[] = [];
    // Every SKU we have a target for OR a synced price for.
    const skuSet = new Set<string>([...costs.keys(), ...pricing.keys()]);
    for (const sku of skuSet) {
      const expected = costs.get(sku)?.expected_in_hand ?? null;
      const feeRate = skuFeeRate.get(sku) ?? globalFeeRate;
      const minPrice = expected != null && feeRate < 1 ? Math.round((expected / (1 - feeRate)) * 100) / 100 : null;
      const pr = pricing.get(sku);
      const myPrice = pr?.my_price ?? null;
      const buybox = pr?.buybox_price ?? null;
      const status: RepriceRow["status"] =
        expected == null ? "no_target" : myPrice == null || minPrice == null ? "no_price" : myPrice < minPrice ? "below" : "ok";
      const buyboxHint: RepriceRow["buyboxHint"] = buybox != null && minPrice != null ? (buybox >= minPrice ? "match" : "dont_chase") : null;
      let suggested: number | null = null;
      if (minPrice != null) {
        if (status === "below") suggested = minPrice;
        else if (buybox != null && buybox >= minPrice && myPrice != null && buybox < myPrice) suggested = buybox;
      }
      out.push({ sku, expected, feeRate, minPrice, myPrice, buybox, isWinner: pr?.is_buybox_winner ?? null, status, buyboxHint, suggested });
    }
    const q = search.trim().toLowerCase();
    return out
      .filter((r) => !q || r.sku.toLowerCase().includes(q))
      .sort((a, b) => rank[a.status] - rank[b.status] || a.sku.localeCompare(b.sku));
  }, [costs, skuFeeRate, globalFeeRate, pricing, search]);

  const belowFloorCount = repriceRows.filter((r) => r.status === "below").length;

  async function syncNow() {
    setSyncing(true); setErr(null); setMsg(null);
    try {
      const r = await syncSeller();
      setMsg(`Synced ${r.orders} order(s), ${r.orderFinance} order financial record(s) from Amazon.${r.warnings.length ? " Note: " + r.warnings.slice(0, 3).join("; ") : ""}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function syncPricesNow() {
    setSyncingPrices(true); setErr(null); setMsg(null);
    try {
      const r = await syncPrices();
      setMsg(`Synced ${r.count} SKU(s) — ${r.withBuyBox} with Buy Box.${r.remaining ? ` ${r.remaining} still need Buy Box — click Sync prices again to backfill.` : ""}${r.note ? ` ${r.note}` : ""}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Price sync failed.");
    } finally {
      setSyncingPrices(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs dark:border-slate-700">
          <button type="button" onClick={() => setView("orders")} className={`px-2.5 py-1 font-medium ${view === "orders" ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>Orders (profit)</button>
          <button type="button" onClick={() => setView("repricing")} className={`px-2.5 py-1 font-medium ${view === "repricing" ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>Repricing (per SKU)</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {manager ? <button type="button" onClick={() => setShowCosts(true)} className={btnSecondary}>🎯 Expected in‑hand</button> : null}
          {view === "repricing" && manager ? <button type="button" onClick={syncPricesNow} disabled={syncingPrices} className={btnSecondary}>{syncingPrices ? "Syncing prices…" : "Sync prices"}</button> : null}
          <button type="button" onClick={syncNow} disabled={syncing} className={btnPrimary}>{syncing ? "Syncing…" : "Sync now"}</button>
        </div>
      </div>

      {msg ? <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}
      {err ? <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

      {view === "orders" ? (
      <>
      {shortCount > 0 ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          ⚠ <strong>{shortCount}</strong> settled order{shortCount === 1 ? "" : "s"} came in <strong>below your expected in‑hand</strong> (Amazon deducted more than planned — eroding profit).
        </div>
      ) : null}
      {noTargetCount > 0 && manager ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {noTargetCount} order{noTargetCount === 1 ? "" : "s"} can&apos;t be checked yet — missing expected in‑hand for a SKU. Set it via <button type="button" onClick={() => setShowCosts(true)} className="underline">🎯 Expected in‑hand</button>.
        </div>
      ) : null}

      {/* Summary cards */}
      {!loading && rows.length > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className={`${surface} p-3`}><div className="text-xs text-slate-500">Net received</div><div className="text-lg font-bold">{formatAED(totals.net)}</div></div>
          <div className={`${surface} p-3`}><div className="text-xs text-slate-500">Amazon fees</div><div className="text-lg font-bold text-rose-600 dark:text-rose-400">{formatAED(totals.fees)}</div></div>
          <div className={`${surface} p-3`}><div className="text-xs text-slate-500">Expected in‑hand (checked orders)</div><div className="text-lg font-bold">{formatAED(totals.expected)}</div></div>
          <div className={`${surface} p-3`}><div className="text-xs text-slate-500">Variance vs expected</div><div className={`text-lg font-bold ${totals.variance < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{formatAED(totals.variance)}</div></div>
        </div>
      ) : null}

      {/* Settlement coverage — explains why some orders have no financials yet. */}
      {!loading && orders.length > 0 ? (
        <details className={`${surface} mb-4 p-3`}>
          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700 dark:text-slate-200">
            Settlement coverage <span className="font-normal text-slate-400">— {orders.length} orders synced, {coverage.find((c) => c.label === "Shipped — settled")?.count ?? 0} settled</span>
          </summary>
          <table className="mt-3 w-full max-w-lg text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1 pr-4 font-medium">Status</th>
                <th className="py-1 pr-4 text-right font-medium">Count</th>
                <th className="py-1 font-medium">Has financials?</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((c) => (
                <tr key={c.label} className="border-t border-slate-200/70 dark:border-slate-800">
                  <td className="py-1 pr-4">{c.label}</td>
                  <td className="py-1 pr-4 text-right font-semibold tabular-nums">{c.count}</td>
                  <td className="py-1 text-slate-500">{c.fin}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">Amazon posts per-order fees/net only after an order ships <em>and</em> settles, so only settled orders are checked against your expected in‑hand here.</p>
        </details>
      ) : null}

      {loading ? (
        <div className={`${surface} p-6 text-center text-sm text-slate-500`}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className={`${surface} p-6 text-center text-sm text-slate-500`}>
          No settled financials yet. Amazon posts per-order fees/net <strong>after an order ships & settles</strong> — click <strong>Sync now</strong>, and figures appear here as orders settle.
        </div>
      ) : (
        <>
        <input
          className={`${inputClass} mb-3 w-full`}
          placeholder="Search by order ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={`${tableWrap} overflow-auto`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thCell}>Order ID</th>
                <th className={thCell}>Settled</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Channel</th>
                <th className={`${thCell} text-right`}>Sales</th>
                <th className={`${thCell} text-right`}>Amazon fees</th>
                <th className={`${thCell} text-right`}>Net received</th>
                <th className={`${thCell} text-right`}>Expected</th>
                <th className={`${thCell} text-right`}>Variance</th>
                <th className={`${thCell} text-right`}>% of target</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr><td className={tdCell} colSpan={10}>No order matches &quot;{search}&quot;. (Pending / unshipped orders appear once settled — see Settlement coverage above.)</td></tr>
              ) : displayRows.map((r) => {
                const loss = r.variance != null && r.variance < 0;
                const isOpen = expanded === r.order.amazon_order_id;
                const bd = (r.fin?.fee_breakdown ?? null) as { events?: { type: string; postedDate: string | null; amount: number }[] } | null;
                const orderItems = itemsByOrder.get(r.order.amazon_order_id) ?? [];
                return (
                  <Fragment key={r.order.id}>
                  <tr className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${r.isCanceled ? "opacity-60" : loss ? "bg-rose-50/50 dark:bg-rose-950/20" : ""}`}>
                    <td className={`${tdCell} font-medium`}>
                      {r.isCanceled ? (
                        <span className="text-slate-500">{r.order.amazon_order_id}</span>
                      ) : (
                        <button type="button" onClick={() => setExpanded(isOpen ? null : r.order.amazon_order_id)} className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400" title="Show transaction breakdown">
                          <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>{r.order.amazon_order_id}
                        </button>
                      )}
                      {orderItems.filter(it => it.seller_sku).length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {orderItems.filter(it => it.seller_sku).map((it, i) => {
                            const hasCost = it.seller_sku ? costs.has(it.seller_sku) : false;
                            return (
                              <span key={i} className={`inline-block rounded px-1 text-[11px] font-mono ${hasCost ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                                {it.seller_sku}{(it.quantity_ordered ?? 1) > 1 ? `×${it.quantity_ordered}` : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className={tdCell}>{fmt(r.fin?.posted_date ?? null)}</td>
                    <td className={tdCell}>
                      <StatusPill order={r.order} />
                      {loss ? <span className="ml-1 inline-block rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">below target</span> : null}
                    </td>
                    <td className={tdCell}>{fulfillmentLabel(r.order)}</td>
                    <td className={`${tdCell} text-right tabular-nums`}>
                      {r.isCanceled ? <span className="text-slate-400">—</span>
                        : r.pendingSettlement ? (
                          <span title="Order total from Amazon — sale not yet settled in Finances API; will update automatically on next sync after settlement">
                            <span className="italic text-slate-400">~{formatAED(r.order.order_total ?? 0)}</span>
                            <span className="ml-1 text-[10px] text-amber-600">⏳</span>
                          </span>
                        ) : money(r.sales)}
                    </td>
                    <td className={`${tdCell} text-right tabular-nums`}>{r.isCanceled ? <span className="text-slate-400">—</span> : money(r.fees, true)}</td>
                    <td className={`${tdCell} text-right font-semibold tabular-nums`}>{r.isCanceled ? <span className="text-slate-400">—</span> : money(r.net)}</td>
                    <td className={`${tdCell} text-right tabular-nums`}>{r.isCanceled ? <span className="text-slate-400">—</span> : r.expectedComplete ? money(r.expected) : <span className="text-amber-600" title="Expected in‑hand not set">set?</span>}</td>
                    <td className={`${tdCell} text-right font-semibold tabular-nums ${r.isCanceled || r.variance == null ? "" : loss ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{r.isCanceled || r.variance == null ? <span className="text-slate-400">—</span> : <>{r.variance >= 0 ? "+" : ""}{money(r.variance)}</>}</td>
                    <td className={`${tdCell} text-right tabular-nums ${r.isCanceled || r.pctOfTarget == null ? "text-slate-400" : r.pctOfTarget < 100 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}`}>{r.isCanceled || r.pctOfTarget == null ? "—" : `${r.pctOfTarget}%`}</td>
                  </tr>
                  {isOpen && !r.isCanceled ? (
                    <tr className="bg-slate-50/70 dark:bg-slate-900/40">
                      <td className={tdCell} colSpan={10}>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            {orderItems.filter(it => it.seller_sku).length > 0 && (
                              <div className="mb-3">
                                <div className="mb-1 text-xs font-semibold text-slate-500">Products in this order</div>
                                <table className="text-xs">
                                  <tbody>
                                    {orderItems.filter(it => it.seller_sku).map((it, idx) => {
                                      const sku = it.seller_sku!;
                                      const target = costs.get(sku)?.expected_in_hand;
                                      return (
                                        <tr key={idx}>
                                          <td className="py-0.5 pr-4 font-mono font-medium">{sku}</td>
                                          <td className="py-0.5 pr-4 text-slate-400">{(it.quantity_ordered ?? 1) > 1 ? `×${it.quantity_ordered}` : ""}</td>
                                          <td className="py-0.5">
                                            {target != null
                                              ? <span className="text-emerald-700 dark:text-emerald-400">Target: {formatAED(target)}/unit</span>
                                              : <button type="button" onClick={() => setShowCosts(sku)} className="text-amber-600 hover:underline dark:text-amber-400" title="Set expected in-hand target for this SKU">set target ↗</button>}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            <div className="mb-1 text-xs font-semibold text-slate-500">Breakdown</div>
                            <table className="text-xs">
                              <tbody>
                                {[
                                  ["Product charges", r.fin?.product_charges],
                                  ["Shipping charged", r.fin?.shipping_charges],
                                  ["Promotions", r.fin?.promo_discount],
                                  ["Referral fee", r.fin?.referral_fee],
                                  ["FBA / fulfillment fee", r.fin?.fba_fee],
                                  ["Other / Easy Ship fees", r.fin?.other_fees],
                                  ["Tax collected", r.fin?.tax_collected],
                                ].map(([label, val]) => (
                                  <tr key={label as string}><td className="py-0.5 pr-6 text-slate-500">{label}</td><td className="py-0.5 text-right tabular-nums">{money(val as number | null | undefined, true)}</td></tr>
                                ))}
                                <tr className="border-t border-slate-300 dark:border-slate-700"><td className="py-1 pr-6 font-semibold">Net received</td><td className="py-1 text-right font-semibold tabular-nums">{money(r.net)}</td></tr>
                                <tr><td className="py-0.5 pr-6 text-slate-500">Expected in‑hand</td><td className="py-0.5 text-right tabular-nums">{r.expectedComplete ? money(r.expected) : <button type="button" onClick={() => setShowCosts(true)} className="text-amber-600 hover:underline" title="Click to set expected in-hand targets per SKU">set?</button>}</td></tr>
                                <tr><td className="py-1 pr-6 font-semibold">Variance vs expected</td><td className={`py-1 text-right font-semibold tabular-nums ${loss ? "text-rose-600" : r.variance != null ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{r.variance == null ? "—" : <>{r.variance >= 0 ? "+" : ""}{formatAED(r.variance)}</>}</td></tr>
                              </tbody>
                            </table>
                            {r.fin?.refund_total ? <p className="mt-1 text-[11px] text-slate-400">Categories are net of a {formatAED(r.fin.refund_total)} refund (see Transactions).</p> : null}
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-semibold text-slate-500">Transactions</div>
                            {bd?.events && bd.events.length > 0 ? (
                              <table className="w-full text-xs">
                                <thead><tr className="text-left text-slate-400"><th className="py-0.5 pr-4 font-medium">Type</th><th className="py-0.5 pr-4 font-medium">Date</th><th className="py-0.5 text-right font-medium">Amount</th></tr></thead>
                                <tbody>
                                  {bd.events.map((ev, i) => (
                                    <tr key={i} className="border-t border-slate-200/70 dark:border-slate-800"><td className="py-0.5 pr-4">{ev.type}</td><td className="py-0.5 pr-4 text-slate-500">{fmt(ev.postedDate)}</td><td className="py-0.5 text-right tabular-nums">{money(ev.amount, true)}</td></tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : <p className="text-xs text-slate-400">Re-run <strong>Sync now</strong> to capture the per-transaction list.</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Net received = Amazon&apos;s actual deposit per order (after referral fee, FBA/fulfillment fees, Easy Ship/other fees, promos &amp; refunds). Variance = net received − your expected in‑hand (the target net you set per SKU, which already includes your profit). A negative variance means Amazon deducted more than planned. Auto‑synced from the Amazon Finances API; only settled orders appear.
      </p>
      </>
      ) : (
      <>
        {belowFloorCount > 0 ? (
          <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            ⚠ <strong>{belowFloorCount}</strong> SKU{belowFloorCount === 1 ? " is" : "s are"} priced <strong>below the floor</strong> that clears your expected in‑hand after fees — raise the price (suggested below).
          </div>
        ) : null}
        <input className={`${inputClass} mb-3 w-full`} placeholder="Search by SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? (
          <div className={`${surface} p-6 text-center text-sm text-slate-500`}>Loading…</div>
        ) : repriceRows.length === 0 ? (
          <div className={`${surface} p-6 text-center text-sm text-slate-500`}>
            Nothing to show yet. Click <strong>Sync prices</strong> to pull your live Amazon prices + Buy Box for SKUs from your orders — then add <strong>🎯 Expected in‑hand</strong> targets to get floor/suggested prices and the below‑target flags.
          </div>
        ) : (
          <div className={`${tableWrap} overflow-auto`}>
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={thCell}>SKU</th>
                  <th className={`${thCell} text-right`}>Your price</th>
                  <th className={`${thCell} text-right`}>Buy Box</th>
                  <th className={`${thCell} text-right`}>Expected in‑hand</th>
                  <th className={`${thCell} text-right`}>Est. fee</th>
                  <th className={`${thCell} text-right`}>Floor price</th>
                  <th className={`${thCell} text-right`}>Suggested</th>
                  <th className={thCell}>Status</th>
                </tr>
              </thead>
              <tbody>
                {repriceRows.map((r) => (
                  <tr key={r.sku} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${r.status === "below" ? "bg-rose-50/50 dark:bg-rose-950/20" : ""}`}>
                    <td className={`${tdCell} font-medium`}>{r.sku}</td>
                    <td className={`${tdCell} text-right tabular-nums`}>{money(r.myPrice)}</td>
                    <td className={`${tdCell} text-right tabular-nums`}>{money(r.buybox)}{r.isWinner ? <span className="ml-1 text-[10px] text-emerald-600" title="You currently win the Buy Box">★</span> : null}</td>
                    <td className={`${tdCell} text-right tabular-nums`}>{money(r.expected)}</td>
                    <td className={`${tdCell} text-right tabular-nums text-slate-500`}>{`${Math.round(r.feeRate * 100)}%`}</td>
                    <td className={`${tdCell} text-right tabular-nums`}>{money(r.minPrice)}</td>
                    <td className={`${tdCell} text-right font-semibold tabular-nums ${r.suggested != null ? "text-indigo-700 dark:text-indigo-300" : "text-slate-400"}`}>{r.suggested != null ? money(r.suggested) : "—"}</td>
                    <td className={tdCell}>
                      {r.status === "no_target" ? <span className="text-amber-600" title="Set an expected in‑hand for this SKU to judge it">set target</span>
                        : r.status === "no_price" ? <span className="text-slate-400">no price — sync</span>
                        : r.status === "below" ? <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">🔴 below floor → raise</span>
                        : <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">🟢 clears target</span>}
                      {r.buyboxHint === "match" && r.status === "ok" ? <span className="ml-1 text-[10px] text-indigo-600 dark:text-indigo-300" title="Buy Box is at/above your floor — you can match it and still profit">💡 can match Buy Box</span> : null}
                      {r.buyboxHint === "dont_chase" ? <span className="ml-1 text-[10px] text-amber-600" title="Buy Box is below your floor — matching it would lose money">⚠ Buy Box below floor</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Floor price = expected in‑hand ÷ (1 − estimated Amazon fee %), i.e. the lowest price that still nets your target after fees. Est. fee % is your own realized rate from settled orders (per SKU where available, else the account average). <strong>Recommend‑only</strong> — prices aren&apos;t pushed to Amazon. Click <strong>Sync prices</strong> to refresh your live price + Buy Box.
        </p>
      </>
      )}

      {showCosts && manager ? <SkuCostsModal onClose={() => setShowCosts(false)} onSaved={() => void load()} initialSku={typeof showCosts === "string" ? showCosts : undefined} /> : null}
    </div>
  );
}

export default function AmazonPricingPage() {
  return (
    <LogisticsShell title="Amazon Profit & Pricing" subtitle="Actual net received and profit per order — auto-synced from Amazon." page="amazon_profit" wide>
      <Content />
    </LogisticsShell>
  );
}
