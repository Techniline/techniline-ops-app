"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, inputClass, tableWrap, tdCell, thCell } from "@/components/ui";
import {
  fetchSellerFinance,
  fetchSellerReturns,
  sellerLastSync,
  syncSeller,
  type SellerFinanceRow,
  type SellerReturnRow,
} from "@/lib/spapi/seller";

type Tab = "finance" | "orders";

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
  const [tab, setTab] = useState<Tab>("finance");
  const [finance, setFinance] = useState<SellerFinanceRow[]>([]);
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
      else setReturns(await fetchSellerReturns(search));
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
      setMsg(`Synced ${r.finance} settlement group(s) and ${r.returns} return(s) from Amazon Seller.${warn}`);
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

      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => setTab("finance")} className={tabBtn("finance", "Finance")}>Finance</button>
        <button type="button" onClick={() => setTab("orders")} className={tabBtn("orders", "Orders / Fulfillment")}>Orders / Fulfillment</button>
      </div>

      {msg ? <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}
      {err ? <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

      <input
        className={`${inputClass} mb-3 w-full`}
        placeholder={tab === "finance" ? "Search settlement group or status…" : "Search order, SKU or ASIN…"}
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
      ) : (
        <div className={`${tableWrap} max-h-[70vh] overflow-auto`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
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
                <tr><td className={tdCell} colSpan={8}>Loading…</td></tr>
              ) : returns.length === 0 ? (
                <tr><td className={tdCell} colSpan={8}>No returns yet — click <strong>Sync now</strong>.</td></tr>
              ) : (
                returns.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
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
        Finance and FBA returns come from Seller Central via SP-API (Finance + Fulfillment roles). Auto-syncs daily; use Sync now for an
        immediate refresh. Per-order live tracking requires the Orders API role (Amazon app review, phase 2).
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
