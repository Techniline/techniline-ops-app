"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { SellerConnectionCheck } from "@/components/SellerConnectionCheck";
import { btnPrimary, inputClass, tableWrap, tdCell, thCell } from "@/components/ui";
import { canViewSellerFinance, canViewSellerOrders, isManager } from "@/lib/permissions";
import {
  fetchSellerFinance,
  fetchSellerOrders,
  sellerLastSync,
  syncSeller,
  type SellerFinanceRow,
  type SellerOrderRow,
} from "@/lib/spapi/seller";

type Tab = "finance" | "orders" | "messages";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}
function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function money(n: number | null, ccy: string | null): string {
  if (n == null) return "—";
  return `${ccy ? ccy + " " : ""}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Fulfillment label in the team's vocabulary. AFN (technically FBA) is shown as
 *  "Flex" per the team's naming; MFN splits into Easy Ship (has an
 *  EasyShipShipmentStatus marker) vs Self Ship. */
function fulfillmentLabel(o: SellerOrderRow): string {
  const ch = (o.fulfillment_channel ?? "").toUpperCase();
  if (ch === "AFN") return "Flex";
  if (ch === "MFN") {
    const raw = (o.raw ?? null) as { EasyShipShipmentStatus?: string } | null;
    return raw?.EasyShipShipmentStatus ? "Easy Ship" : "Self Ship";
  }
  return o.fulfillment_channel ?? "—";
}

/** Any order with unshipped items that isn't already shipped or cancelled —
 *  flagged as unfulfilled regardless of channel (Flex / Easy Ship / Self Ship). */
function needsFulfillment(o: SellerOrderRow): boolean {
  const st = (o.order_status ?? "").toLowerCase();
  if (st === "shipped" || st.includes("cancel")) return false;
  return (o.items_unshipped ?? 0) > 0;
}

function Content() {
  const { profile } = useAuth();
  const showOrders = canViewSellerOrders(profile);
  const showFinance = canViewSellerFinance(profile);
  const [tab, setTab] = useState<Tab>(showFinance && !showOrders ? "finance" : "orders");
  const [finance, setFinance] = useState<SellerFinanceRow[]>([]);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [channel, setChannel] = useState<string>("all");
  const [unfulfilledOnly, setUnfulfilledOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "finance") setFinance(await fetchSellerFinance(search));
      else if (tab === "orders") setOrders(await fetchSellerOrders(search));
      // "messages" deep-links to Seller Central; "returns" moved to Marketplace Returns
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void sellerLastSync().then(setLastSync);
  }, []);

  async function sync() {
    setSyncing(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await syncSeller();
      const warn = r.warnings.length ? ` (${r.warnings.join("; ")})` : "";
      setMsg(`Synced ${r.orders} order(s) and ${r.finance} settlement group(s) from Amazon Seller.${warn}`);
      setLastSync(r.lastSync);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSyncing(false);
    }
  }

  const tabBtn = (key: Tab, label: string) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      tab === key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
    }`;

  return (
    <div>
      <PageHeader
        title="Amazon Seller Central"
        subtitle="Finance and order/fulfillment data synced live from Seller Central via SP-API."
        actions={
          <div className="flex items-center gap-2">
            {lastSync ? <span className="text-xs text-slate-500">Last sync: {fmt(lastSync)}</span> : null}
            <button type="button" onClick={sync} disabled={syncing} className={btnPrimary}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
        }
      />

      {isManager(profile) ? <SellerConnectionCheck /> : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {showFinance ? (
          <button type="button" onClick={() => setTab("finance")} className={tabBtn("finance", "Finance")}>Finance / Payment</button>
        ) : null}
        {showOrders ? (
          <>
            <button type="button" onClick={() => setTab("orders")} className={tabBtn("orders", "Orders")}>Orders / Fulfillment</button>
            <button type="button" onClick={() => setTab("messages")} className={tabBtn("messages", "Messages")}>Buyer Messages</button>
          </>
        ) : null}
      </div>

      {msg ? <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}
      {err ? <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

      <input
        className={`${inputClass} mb-3 w-full`}
        placeholder={
          tab === "finance"
            ? "Search settlement group or status…"
            : tab === "orders"
              ? "Search order ID, status or channel…"
              : "Search order, SKU or ASIN…"
        }
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {tab === "finance" ? (
        <div className={`${tableWrap} max-h-[70vh] overflow-auto`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thCell}>Settlement group</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Period start</th>
                <th className={thCell}>Period end</th>
                <th className={thCell}>Fund transfer</th>
                <th className={thCell}>Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className={tdCell} colSpan={6}>Loading…</td></tr>
              ) : finance.length === 0 ? (
                <tr><td className={tdCell} colSpan={6}>No settlements yet — click <strong>Sync now</strong>.</td></tr>
              ) : (
                finance.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className={`${tdCell} font-medium`}>{r.group_id}</td>
                    <td className={tdCell}>{r.status ?? "—"}</td>
                    <td className={tdCell}>{fmt(r.start_time)}</td>
                    <td className={tdCell}>{fmt(r.end_time)}</td>
                    <td className={tdCell}>{fmt(r.fund_transfer_date)}</td>
                    <td className={`${tdCell} tabular-nums`}>{money(r.original_total, r.currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : tab === "orders" ? (
        <>
          {(() => {
            const channels = Array.from(new Set(orders.map(fulfillmentLabel).filter((c) => c !== "—")));
            if (channels.length < 2) return null;
            const chip = (key: string, label: string) =>
              `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                channel === key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`;
            return (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">Fulfillment:</span>
                <button type="button" onClick={() => setChannel("all")} className={chip("all", "All")}>All</button>
                {channels.map((c) => (
                  <button key={c} type="button" onClick={() => setChannel(c)} className={chip(c, c)}>{c}</button>
                ))}
              </div>
            );
          })()}
          {(() => {
            const inChannel = orders.filter((o) => channel === "all" || fulfillmentLabel(o) === channel);
            const n = inChannel.filter(needsFulfillment).length;
            if (n === 0) return null;
            return (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  ⚠ {n} order{n > 1 ? "s" : ""} need fulfillment (unshipped)
                </span>
                <button
                  type="button"
                  onClick={() => setUnfulfilledOnly((v) => !v)}
                  className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
                >
                  {unfulfilledOnly ? "Show all orders" : "Show only these"}
                </button>
              </div>
            );
          })()}
          <div className={`${tableWrap} max-h-[70vh] overflow-auto`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thCell}>Order ID</th>
                <th className={thCell}>Date</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Fulfillment</th>
                <th className={thCell}>Shipped</th>
                <th className={thCell}>Unshipped</th>
                <th className={thCell}>Total</th>
                <th className={thCell}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const shown = orders
                  .filter((o) => channel === "all" || fulfillmentLabel(o) === channel)
                  .filter((o) => !unfulfilledOnly || needsFulfillment(o))
                  // Surface unfulfilled orders first so they don't get lost.
                  .sort(
                    (a, b) =>
                      (needsFulfillment(b) ? 1 : 0) - (needsFulfillment(a) ? 1 : 0) ||
                      (b.purchase_date ?? "").localeCompare(a.purchase_date ?? "")
                  );
                if (loading) return <tr><td className={tdCell} colSpan={8}>Loading…</td></tr>;
                if (shown.length === 0)
                  return (
                    <tr><td className={tdCell} colSpan={8}>
                      {orders.length === 0 ? <>No orders yet — click <strong>Sync now</strong>.</> : "No matching orders."}
                    </td></tr>
                  );
                return shown.map((r) => (
                  <tr key={r.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${needsFulfillment(r) ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
                    <td className={`${tdCell} font-medium`}>{r.amazon_order_id}</td>
                    <td className={tdCell}>{fmt(r.purchase_date)}</td>
                    <td className={tdCell}>
                      {needsFulfillment(r) ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">Unfulfilled</span>
                      ) : (
                        <span className="text-slate-600 dark:text-slate-300">{r.order_status ?? "—"}</span>
                      )}
                    </td>
                    <td className={tdCell}>{fulfillmentLabel(r)}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.items_shipped ?? "—"}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.items_unshipped ?? "—"}</td>
                    <td className={`${tdCell} tabular-nums`}>{money(r.order_total, r.currency)}</td>
                    <td className={tdCell}>{fmt(r.last_update_date)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <div className={`${tableWrap} px-4 py-6 text-sm text-slate-600 dark:text-slate-300`}>
          <p className="font-medium text-slate-800 dark:text-slate-100">Buyer messages open in Seller Central</p>
          <p className="mt-2 max-w-2xl text-slate-500">
            Amazon&apos;s SP-API doesn&apos;t expose the buyer-message inbox for reading — the Messaging API only sends messages, it can&apos;t
            list incoming ones. So buyer messages are handled in Seller Central; open the inbox below to read and reply.
          </p>
          <a
            href="https://sellercentral.amazon.ae/messaging/inbox"
            target="_blank"
            rel="noreferrer"
            className={`${btnPrimary} mt-4 inline-flex items-center gap-1.5`}
          >
            Open buyer messages in Seller Central ↗
          </a>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Orders &amp; finance settlements sync from Seller Central via SP-API. Returns now live in <strong>Marketplace Returns</strong>
        (Logistics → Channels). Auto-syncs daily; use Sync now for an immediate refresh.
      </p>
    </div>
  );
}

export default function SellerCentralPage() {
  return (
    <RouteGuard requireCapability="seller_central">
      <AppShell>
        <Content />
      </AppShell>
    </RouteGuard>
  );
}
