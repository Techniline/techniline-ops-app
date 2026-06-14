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
  fetchSellerReturns,
  sellerLastSync,
  syncSeller,
  type SellerFinanceRow,
  type SellerOrderRow,
  type SellerReturnRow,
} from "@/lib/spapi/seller";

type Tab = "finance" | "orders" | "messages" | "returns";

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

function Content() {
  const { profile } = useAuth();
  const showOrders = canViewSellerOrders(profile);
  const showFinance = canViewSellerFinance(profile);
  const [tab, setTab] = useState<Tab>(showFinance && !showOrders ? "finance" : "orders");
  const [finance, setFinance] = useState<SellerFinanceRow[]>([]);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [channel, setChannel] = useState<string>("all");
  const [returns, setReturns] = useState<SellerReturnRow[]>([]);
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
      else if (tab === "returns") setReturns(await fetchSellerReturns(search));
      // "messages" has no data source yet (pending Buyer Communication role)
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
      setMsg(`Synced ${r.orders} order(s), ${r.finance} settlement group(s) and ${r.returns} return(s) from Amazon Seller.${warn}`);
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
            <button type="button" onClick={() => setTab("returns")} className={tabBtn("returns", "Returns")}>Returns</button>
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
            const channels = Array.from(new Set(orders.map((o) => o.fulfillment_channel).filter(Boolean) as string[]));
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
                const shown = orders.filter((o) => channel === "all" || o.fulfillment_channel === channel);
                if (loading) return <tr><td className={tdCell} colSpan={8}>Loading…</td></tr>;
                if (shown.length === 0)
                  return (
                    <tr><td className={tdCell} colSpan={8}>
                      {orders.length === 0 ? <>No orders yet — click <strong>Sync now</strong>.</> : "No orders in this fulfillment channel."}
                    </td></tr>
                  );
                return shown.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className={`${tdCell} font-medium`}>{r.amazon_order_id}</td>
                    <td className={tdCell}>{fmt(r.purchase_date)}</td>
                    <td className={tdCell}>{r.order_status ?? "—"}</td>
                    <td className={tdCell}>{r.fulfillment_channel ?? "—"}</td>
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
      ) : tab === "messages" ? (
        <div className={`${tableWrap} px-4 py-6 text-sm text-slate-600 dark:text-slate-300`}>
          <p className="font-medium text-slate-800 dark:text-slate-100">Buyer messages open in Seller Central</p>
          <p className="mt-2 max-w-2xl text-slate-500">
            Reading buyer messages inside this app needs Amazon&apos;s restricted Buyer Communication role (a public app-listing review),
            so for now we link straight to your Seller Central message inbox — your team can read and reply there.
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
      ) : (
        <div className={`${tableWrap} max-h-[70vh] overflow-auto`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thCell}>Type</th>
                <th className={thCell}>Order ID</th>
                <th className={thCell}>SKU</th>
                <th className={thCell}>ASIN</th>
                <th className={thCell}>Return date</th>
                <th className={thCell}>Qty</th>
                <th className={thCell}>Reason</th>
                <th className={thCell}>Disposition</th>
                <th className={thCell}>FC</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className={tdCell} colSpan={9}>Loading…</td></tr>
              ) : returns.length === 0 ? (
                <tr><td className={tdCell} colSpan={9}>No returns yet — click <strong>Sync now</strong>.</td></tr>
              ) : (
                returns.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className={tdCell}>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.source === "mfn" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {r.source ? r.source.toUpperCase() : "—"}
                      </span>
                    </td>
                    <td className={`${tdCell} font-medium`}>{r.order_id ?? "—"}</td>
                    <td className={tdCell}>{r.sku ?? "—"}</td>
                    <td className={tdCell}>{r.asin ?? "—"}</td>
                    <td className={tdCell}>{fmt(r.return_date)}</td>
                    <td className={`${tdCell} tabular-nums`}>{r.quantity ?? "—"}</td>
                    <td className={tdCell}>{r.reason ?? "—"}</td>
                    <td className={tdCell}>{r.detailed_disposition ?? "—"}</td>
                    <td className={tdCell}>{r.fulfillment_center ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Orders, finance settlements, and FBA returns come from Seller Central via SP-API. Auto-syncs daily; use Sync now for an immediate
        refresh. Order rows show status, fulfillment channel and shipment counts; buyer personal data is not included.
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
