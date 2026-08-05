"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, surface, tdCell, thCell } from "@/components/ui";
import { formatAED } from "@/lib/format";
import { supabase } from "@/lib/supabaseClient";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong.";
}

// ── Types ────────────────────────────────────────────────────────────────────

interface NoonOrderRawItem {
  sku: string;
  name?: string;
  qty: number;
  status?: string;
  awb_nr?: string;
  shipment_nr?: string;
  is_fbn?: boolean;
}

interface NoonOrder {
  id: string;
  order_nr: string;
  order_date: string | null;
  status: string | null;
  payment_type: string | null;
  channel: string | null;
  customer_zone: string | null;
  total_aed: number | null;
  item_count: number | null;
  sku: string | null;
  qty: number | null;
  synced_at: string;
  raw_data?: { items?: NoonOrderRawItem[] } | null;
}

interface NoonStatement {
  id: string;
  statement_id: string;
  payment_date: string | null;
  period_from: string | null;
  period_to: string | null;
  gross_sales_aed: number | null;
  total_fees_aed: number | null;
  total_returns_aed: number | null;
  net_amount_aed: number | null;
  status: string | null;
  synced_at: string;
}

interface NoonReturn {
  id: string;
  return_id: string;
  order_nr: string | null;
  return_date: string | null;
  reason: string | null;
  status: string | null;
  sku: string | null;
  qty: number | null;
  return_amount_aed: number | null;
  resolution: string | null;
  recon_remark: string | null;
  raw_data?: { product_title?: string } | null;
}

interface StatementLine {
  id: string;
  order_nr: string | null;
  transaction_type: string | null;
  description: string | null;
  sku: string | null;
  qty: number | null;
  amount_aed: number | null;
  transaction_date: string | null;
}

// ── Status badges ────────────────────────────────────────────────────────────

const ORDER_STATUS_STYLE: Record<string, string> = {
  shipped:          "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  delivered:        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled:        "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  returned:         "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  pending_fulfill:  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const RETURN_STATUS_STYLE: Record<string, string> = {
  items_returned:   "bg-amber-100 text-amber-700   dark:bg-amber-950/60 dark:text-amber-300",
  refunded:         "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  rejected:         "bg-rose-100 text-rose-700     dark:bg-rose-950/60 dark:text-rose-300",
  return_requested: "bg-sky-100 text-sky-700       dark:bg-sky-950/60 dark:text-sky-300",
  completed:        "bg-teal-100 text-teal-700     dark:bg-teal-950/60 dark:text-teal-300",
  closed:           "bg-slate-100 text-slate-500   dark:bg-slate-800 dark:text-slate-400",
};

function Badge({ label, styleMap, fallback = "bg-slate-100 text-slate-500" }: { label: string; styleMap: Record<string, string>; fallback?: string }) {
  const cls = styleMap[label] ?? fallback;
  return (
    <span className={`inline-block rounded-lg px-3 py-1 text-xs font-semibold capitalize tracking-wide ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ── Sync controls ────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);
const PRESETS: { label: string; from: string }[] = [
  { label: "30 d",  from: new Date(Date.now() - 30  * 86_400_000).toISOString().slice(0, 10) },
  { label: "3 mo",  from: new Date(Date.now() - 90  * 86_400_000).toISOString().slice(0, 10) },
  { label: "2026",  from: "2026-01-01" },
  { label: "2025",  from: "2025-01-01" },
];

function SyncPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const [syncing, setSyncing] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState(TODAY);

  async function syncEndpoint(label: string, path: string, body: unknown) {
    setSyncing(label);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json() as Record<string, unknown>;
      if (!j.ok) throw new Error(String(j.error ?? "Unknown error"));
      const detail = Object.entries(j)
        .filter(([k]) => k !== "ok")
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 200) : v}`)
        .join(", ");
      setLog((l) => [`✓ ${label} — ${detail}`, ...l]);
      onDone();
    } catch (e) {
      setLog((l) => [`✗ ${label} — ${errorMessage(e)}`, ...l]);
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className={`${surface} p-4`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Sync from Noon API</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400">From</label>
        <input
          type="date"
          value={fromDate}
          max={toDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
        <label className="text-xs text-slate-500 dark:text-slate-400">To</label>
        <input
          type="date"
          value={toDate}
          min={fromDate}
          max={TODAY}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
        <span className="text-slate-300 dark:text-slate-600">|</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => { setFromDate(p.from); setToDate(p.label === "2025" ? "2025-12-31" : TODAY); }}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              fromDate === p.from
                ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!syncing} onClick={() => syncEndpoint("Orders", "/api/noon/sync-orders", { from_date: fromDate, to_date: toDate })} className={btnSecondary}>
          {syncing === "Orders" ? "Syncing…" : "Sync Orders"}
        </button>
        <button type="button" disabled={!!syncing} onClick={() => syncEndpoint("Returns", "/api/noon/sync-returns", { from_date: fromDate, to_date: toDate })} className={btnSecondary}>
          {syncing === "Returns" ? "Syncing…" : "Sync Returns"}
        </button>
        <button type="button" disabled={!!syncing} onClick={() => syncEndpoint("Statements", "/api/noon/sync-statements", { from_date: fromDate, to_date: toDate })} className={btnPrimary}>
          {syncing === "Statements" ? "Syncing…" : "Sync Statements"}
        </button>
      </div>

      {log.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {log.map((l, i) => (
            <li key={i} className={`text-xs font-mono ${l.startsWith("✓") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Statement lines drawer ───────────────────────────────────────────────────

function StatementLines({ statementId }: { statementId: string }) {
  const [lines, setLines] = useState<StatementLine[] | null>(null);

  useEffect(() => {
    db.from("noon_statement_lines")
      .select("*")
      .eq("statement_id", statementId)
      .order("transaction_date", { ascending: false })
      .then(({ data }: { data: StatementLine[] | null }) => setLines(data ?? []));
  }, [statementId]);

  if (!lines) return <p className="mt-2 px-2 text-xs text-slate-400">Loading…</p>;
  if (!lines.length) return <p className="mt-2 px-2 text-xs text-slate-400">No line items synced for this statement.</p>;

  const total = lines.reduce((s, l) => s + (l.amount_aed ?? 0), 0);

  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/50">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Date</th>
            <th className="px-2 py-1 text-left font-medium">Type</th>
            <th className="px-2 py-1 text-left font-medium">Order</th>
            <th className="px-2 py-1 text-left font-medium">SKU</th>
            <th className="px-2 py-1 text-left font-medium">Description</th>
            <th className="px-2 py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-2 py-1 text-slate-500">{l.transaction_date ?? "—"}</td>
              <td className="px-2 py-1 capitalize text-slate-600">{l.transaction_type?.replace(/_/g, " ") ?? "—"}</td>
              <td className="px-2 py-1 font-medium text-slate-800 dark:text-slate-200">{l.order_nr ?? "—"}</td>
              <td className="px-2 py-1 text-slate-500">{l.sku ?? "—"}</td>
              <td className="px-2 py-1 text-slate-500">{l.description ?? "—"}</td>
              <td className={`px-2 py-1 text-right tabular-nums font-medium ${(l.amount_aed ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-300"}`}>
                {l.amount_aed != null ? formatAED(l.amount_aed) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50 dark:bg-slate-800/50">
          <tr>
            <td colSpan={5} className="px-2 py-1 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Net</td>
            <td className={`px-2 py-1 text-right tabular-nums text-xs font-bold ${total < 0 ? "text-rose-600" : "text-emerald-600"}`}>{formatAED(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Order items breakdown row ────────────────────────────────────────────────

function OrderItemsRow({ order, colSpan }: { order: NoonOrder; colSpan: number }) {
  const items = order.raw_data?.items;
  if (!items?.length) {
    return (
      <tr>
        <td colSpan={colSpan} className="bg-slate-50/60 px-4 py-2 text-xs text-slate-400 dark:bg-slate-800/30">
          No item breakdown available — re-sync orders to load per-item details.
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td colSpan={colSpan} className="bg-slate-50/60 px-4 py-2 dark:bg-slate-800/30">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="py-0.5 pr-4 text-left font-medium">Item #</th>
              <th className="py-0.5 pr-4 text-left font-medium">SKU</th>
              <th className="py-0.5 pr-4 text-left font-medium">Status</th>
              <th className="py-0.5 pr-4 text-left font-medium">AWB</th>
              <th className="py-0.5 pr-4 text-left font-medium">Shipment</th>
              <th className="py-0.5 text-left font-medium">Fulfilled by</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-0.5 pr-4 font-mono text-slate-500">{item.name ?? "—"}</td>
                <td className="py-0.5 pr-4 font-medium text-slate-700 dark:text-slate-300">{item.sku}</td>
                <td className="py-0.5 pr-4 capitalize text-slate-500">{item.status?.replace(/_/g, " ") ?? "—"}</td>
                <td className="py-0.5 pr-4 font-mono text-slate-500">{item.awb_nr ?? "—"}</td>
                <td className="py-0.5 pr-4 font-mono text-slate-500">{item.shipment_nr ?? "—"}</td>
                <td className="py-0.5 text-slate-500">{item.is_fbn ? "Noon FBN" : "Partner"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type Tab = "statements" | "orders" | "returns" | "messages";

export default function NoonPage() {
  const [token, setToken] = useState("");
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? ""));
  }, []);

  // Read initial tab + optional order highlight from URL
  const [tab, setTab] = useState<Tab>("statements");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    if (t === "orders" || t === "statements" || t === "returns" || t === "messages") setTab(t);
    const orderParam = p.get("order");
    if (orderParam) {
      setExpandedOrder(orderParam);
      if (!t) setTab("orders");
    }
  }, []);

  const [orders, setOrders] = useState<NoonOrder[]>([]);
  const [statements, setStatements] = useState<NoonStatement[]>([]);
  const [returns, setReturns] = useState<NoonReturn[]>([]);
  const [noonLinkedIds, setNoonLinkedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [expandedStmt, setExpandedStmt] = useState<string | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [retFrom, setRetFrom] = useState("");
  const [retTo, setRetTo] = useState("");
  const [ordFrom, setOrdFrom] = useState("");
  const [ordTo, setOrdTo] = useState("");
  const [stmtFrom, setStmtFrom] = useState("");
  const [stmtTo, setStmtTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [oRes, sRes, rRes, linkedRes] = await Promise.all([
      db.from("noon_orders").select("*").order("order_date", { ascending: false }).limit(200),
      db.from("noon_statements").select("*").order("payment_date", { ascending: false }).limit(50),
      db.from("noon_returns").select("*").order("return_date", { ascending: false }).limit(200),
      db.from("marketplace_returns").select("return_ref").eq("channel", "noon"),
    ]);
    setOrders((oRes.data ?? []) as NoonOrder[]);
    setStatements((sRes.data ?? []) as NoonStatement[]);
    setReturns((rRes.data ?? []) as NoonReturn[]);
    const ids = new Set<string>(
      ((linkedRes.data ?? []) as { return_ref: string | null }[])
        .map((r) => r.return_ref ?? "")
        .filter(Boolean)
    );
    setNoonLinkedIds(ids);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalOrders = orders.length;
  const deliveredOrders = orders.filter((o) => o.status === "delivered").length;
  const openReturns = returns.filter((r) => r.status !== "refunded" && r.status !== "rejected" && r.status !== "completed" && r.status !== "closed").length;
  const filteredReturns = returns.filter((r) => {
    const d = r.return_date ?? "";
    if (retFrom && d < retFrom) return false;
    if (retTo   && d > retTo)   return false;
    return true;
  });
  const filteredOrders = orders.filter((o) => {
    const d = o.order_date ?? "";
    if (ordFrom && d < ordFrom) return false;
    if (ordTo   && d > ordTo)   return false;
    return true;
  });
  const filteredStatements = statements.filter((s) => {
    const d = s.payment_date ?? s.period_from ?? "";
    if (stmtFrom && d < stmtFrom) return false;
    if (stmtTo   && d > stmtTo)   return false;
    return true;
  });
  const unloggedReturns = returns.filter((r) => !noonLinkedIds.has(r.return_id)).length;
  const lastStatement = statements[0];
  const returnedAmount = returns.reduce((s, r) => s + Math.abs(r.return_amount_aed ?? 0), 0);

  const TAB_BASE = "px-4 py-2 text-sm font-semibold rounded-xl border-2 transition-colors";
  const TAB_CHIPS: Record<Tab, { active: string; inactive: string }> = {
    statements: {
      active:   `${TAB_BASE} bg-violet-100 text-violet-800 border-violet-400 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-500`,
      inactive: `${TAB_BASE} bg-violet-50 text-violet-500 border-violet-200 hover:bg-violet-100 hover:text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-900/40`,
    },
    orders: {
      active:   `${TAB_BASE} bg-sky-100 text-sky-800 border-sky-400 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-500`,
      inactive: `${TAB_BASE} bg-sky-50 text-sky-500 border-sky-200 hover:bg-sky-100 hover:text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-800 dark:hover:bg-sky-900/40`,
    },
    returns: {
      active:   `${TAB_BASE} bg-amber-100 text-amber-800 border-amber-400 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-500`,
      inactive: `${TAB_BASE} bg-amber-50 text-amber-500 border-amber-200 hover:bg-amber-100 hover:text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/40`,
    },
    messages: {
      active:   `${TAB_BASE} bg-emerald-100 text-emerald-800 border-emerald-400 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-500`,
      inactive: `${TAB_BASE} bg-emerald-50 text-emerald-500 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/40`,
    },
  };

  return (
    <LogisticsShell
      title="Noon"
      subtitle="Orders, statements, and returns from your Noon Seller account."
      page="noon"
      altCapability="finance"
    >
      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Orders synced", value: totalOrders.toString() },
          { label: "Delivered", value: deliveredOrders.toString(), sub: totalOrders > 0 ? `${Math.round(deliveredOrders / totalOrders * 100)}%` : "—" },
          { label: "Open Returns", value: openReturns.toString(), alert: openReturns > 0 },
          { label: "Last Net Payment", value: lastStatement ? formatAED(lastStatement.net_amount_aed ?? 0) : "—", sub: lastStatement?.payment_date ?? undefined },
        ].map((k) => (
          <div key={k.label} className={`${surface} p-4`}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${k.alert ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>{k.value}</p>
            {k.sub && <p className="mt-0.5 text-xs text-slate-400">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Sync panel */}
      {token && <div className="mb-6"><SyncPanel token={token} onDone={load} /></div>}

      {/* Cross-link banner — unlogged returns */}
      {!loading && unloggedReturns > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <span className="font-medium">{unloggedReturns} Noon return{unloggedReturns !== 1 ? "s" : ""} not yet logged in Marketplace Returns.</span>
          <Link href="/logistics/returns" className="ml-auto rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40">
            Open Marketplace Returns →
          </Link>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(["statements", "orders", "returns", "messages"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={TAB_CHIPS[t][tab === t ? "active" : "inactive"]}>
            {t === "statements" ? `Statements (${statements.length})` :
             t === "orders"     ? `Orders (${orders.length})` :
             t === "returns"    ? `Returns (${returns.length})` :
             "Messages"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (

        /* ── Statements ── */
        tab === "statements" ? (
          <div>
            {/* Date filter */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">From</label>
              <input type="date" value={stmtFrom} max={stmtTo || TODAY} onChange={(e) => setStmtFrom(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">To</label>
              <input type="date" value={stmtTo} min={stmtFrom} max={TODAY} onChange={(e) => setStmtTo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
              {(stmtFrom || stmtTo) && (
                <button type="button" onClick={() => { setStmtFrom(""); setStmtTo(""); }}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700">
                  Clear
                </button>
              )}
              {(stmtFrom || stmtTo) && (
                <span className="text-xs text-slate-400">{filteredStatements.length} of {statements.length} shown</span>
              )}
            </div>
            <div className={surface}>
            {statements.length === 0 ? (
              <p className="p-6 text-sm text-slate-400">No statements synced yet. Use "Sync Statements" above to pull from Noon API.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredStatements.map((s) => {
                  const isOpen = expandedStmt === s.statement_id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedStmt(isOpen ? null : s.statement_id)}
                        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.statement_id}</p>
                          <p className="text-xs text-slate-400">
                            Period: {s.period_from ?? "—"} → {s.period_to ?? "—"} · Paid: {s.payment_date ?? "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatAED(s.net_amount_aed ?? 0)}</p>
                          <p className="text-xs text-slate-400">Net</p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{formatAED(s.gross_sales_aed ?? 0)}</p>
                          <p className="text-[10px] text-slate-400">Gross sales</p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs tabular-nums text-rose-600 dark:text-rose-400">{formatAED(-(s.total_fees_aed ?? 0))}</p>
                          <p className="text-[10px] text-slate-400">Fees</p>
                        </div>
                        <div className="hidden text-right sm:block">
                          <p className="text-xs tabular-nums text-rose-600 dark:text-rose-400">{formatAED(-(s.total_returns_aed ?? 0))}</p>
                          <p className="text-[10px] text-slate-400">Returns</p>
                        </div>
                        <span className="text-xs text-slate-300">{isOpen ? "▲" : "▼"}</span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4">
                          <StatementLines statementId={s.statement_id} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            </div>
          </div>

        /* ── Orders ── */
        ) : tab === "orders" ? (
          <div>
            {/* Date filter */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">From</label>
              <input type="date" value={ordFrom} max={ordTo || TODAY} onChange={(e) => setOrdFrom(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">To</label>
              <input type="date" value={ordTo} min={ordFrom} max={TODAY} onChange={(e) => setOrdTo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" />
              {(ordFrom || ordTo) && (
                <button type="button" onClick={() => { setOrdFrom(""); setOrdTo(""); }}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700">
                  Clear
                </button>
              )}
              {(ordFrom || ordTo) && (
                <span className="text-xs text-slate-400">{filteredOrders.length} of {orders.length} shown</span>
              )}
            </div>
            <div className={surface}>
            {orders.length === 0 ? (
              <p className="p-6 text-sm text-slate-400">No orders synced yet. Use "Sync Orders" above.</p>
            ) : (
              <div className="max-h-[65vh] overflow-x-auto overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className={thCell}>Order #</th>
                      <th className={thCell}>Date</th>
                      <th className={thCell}>Status</th>
                      <th className={thCell}>Items</th>
                      <th className={thCell}>Channel</th>
                      <th className={thCell}>Payment</th>
                      <th className={`${thCell} text-right`}>Total</th>
                      <th className={thCell}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredOrders.map((o) => {
                      const isExpanded = expandedOrder === o.order_nr;
                      return (
                        <Fragment key={o.id}>
                          <tr
                            onClick={() => setExpandedOrder(isExpanded ? null : o.order_nr)}
                            className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
                          >
                            <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>{o.order_nr}</td>
                            <td className={tdCell}>{o.order_date ?? "—"}</td>
                            <td className={tdCell}>{o.status ? <Badge label={o.status} styleMap={ORDER_STATUS_STYLE} /> : "—"}</td>
                            <td className={`${tdCell} tabular-nums`}>{o.item_count ?? o.qty ?? "—"}</td>
                            <td className={tdCell}>{o.channel ?? "—"}</td>
                            <td className={`${tdCell} capitalize`}>{o.payment_type?.replace(/_/g, " ") ?? "—"}</td>
                            <td className={`${tdCell} text-right tabular-nums font-medium`}>{o.total_aed != null ? formatAED(o.total_aed) : "—"}</td>
                            <td className={`${tdCell} text-xs text-slate-300`}>{isExpanded ? "▲" : "▼"}</td>
                          </tr>
                          {isExpanded && <OrderItemsRow order={o} colSpan={8} />}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </div>

        /* ── Returns ── */
        ) : tab === "returns" ? (
          <div>
            {openReturns > 0 && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <strong>{openReturns} open return{openReturns !== 1 ? "s" : ""}</strong> need resolution · Total exposure: {formatAED(returnedAmount)}
              </div>
            )}

            {/* Date filter */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">From</label>
              <input
                type="date"
                value={retFrom}
                max={retTo || TODAY}
                onChange={(e) => setRetFrom(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">To</label>
              <input
                type="date"
                value={retTo}
                min={retFrom}
                max={TODAY}
                onChange={(e) => setRetTo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
              {(retFrom || retTo) && (
                <button
                  type="button"
                  onClick={() => { setRetFrom(""); setRetTo(""); }}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Clear
                </button>
              )}
              {(retFrom || retTo) && (
                <span className="text-xs text-slate-400">
                  {filteredReturns.length} of {returns.length} shown
                </span>
              )}
            </div>

            {/* Cross-link callout */}
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
              <span>Noon returns must also be logged in Marketplace Returns for warehouse documentation.</span>
              <Link href="/logistics/returns?channel_filter=noon" className="ml-auto whitespace-nowrap font-medium underline underline-offset-2 hover:text-sky-900 dark:hover:text-sky-100">
                View Marketplace Returns →
              </Link>
            </div>

            <div className={surface}>
              {returns.length === 0 ? (
                <p className="p-6 text-sm text-slate-400">No returns synced yet. Use "Sync Returns" above.</p>
              ) : (
                <div className="max-h-[65vh] overflow-x-auto overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 dark:bg-slate-800">
                      <tr>
                        <th className={thCell}>Return ID</th>
                        <th className={thCell}>Order #</th>
                        <th className={thCell}>Product</th>
                        <th className={thCell}>Date</th>
                        <th className={thCell}>SKU</th>
                        <th className={thCell}>Reason</th>
                        <th className={thCell}>Status</th>
                        <th className={thCell}>Resolution</th>
                        <th className={`${thCell} text-right`}>Amount</th>
                        <th className={thCell}>Returns Log</th>
                        <th className={thCell}>Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredReturns.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                          <td className={`${tdCell} font-mono text-xs text-slate-600 dark:text-slate-400`}>{r.return_id}</td>
                          <td className={tdCell}>
                            {r.order_nr ? (
                              <button
                                type="button"
                                onClick={() => { setTab("orders"); setExpandedOrder(r.order_nr); }}
                                className="font-medium text-sky-600 hover:underline dark:text-sky-400"
                              >
                                {r.order_nr}
                              </button>
                            ) : "—"}
                          </td>
                          <td className={`${tdCell} max-w-[200px] truncate`} title={r.raw_data?.product_title ?? ""}>
                            {r.raw_data?.product_title ?? "—"}
                          </td>
                          <td className={tdCell}>{r.return_date ?? "—"}</td>
                          <td className={tdCell}>{r.sku ?? "—"}</td>
                          <td className={`${tdCell} max-w-[160px] truncate`} title={r.reason ?? ""}>{r.reason ?? "—"}</td>
                          <td className={tdCell}>{r.status ? <Badge label={r.status} styleMap={RETURN_STATUS_STYLE} /> : "—"}</td>
                          <td className={`${tdCell} capitalize`}>{r.resolution?.replace(/_/g, " ") ?? "—"}</td>
                          <td className={`${tdCell} text-right tabular-nums font-medium text-rose-600 dark:text-rose-400`}>
                            {r.return_amount_aed != null ? formatAED(r.return_amount_aed) : "—"}
                          </td>
                          <td className={tdCell}>
                            {noonLinkedIds.has(r.return_id) ? (
                              <Link
                                href="/logistics/returns"
                                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400"
                              >
                                ✓ Logged
                              </Link>
                            ) : (
                              <Link
                                href={`/logistics/returns?prefill=1&channel=noon&return_ref=${encodeURIComponent(r.return_id)}&order_ref=${encodeURIComponent(r.order_nr ?? "")}&sku=${encodeURIComponent(r.sku ?? "")}&product=${encodeURIComponent(r.raw_data?.product_title ?? "")}&return_date=${encodeURIComponent(r.return_date ?? "")}`}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400"
                              >
                                Log →
                              </Link>
                            )}
                          </td>
                          <td className={tdCell}>
                            <RemarkCell returnId={r.return_id} value={r.recon_remark} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        /* ── Messages ── */
        ) : (
          <div className={`${surface} flex flex-col items-center gap-4 px-6 py-12 text-center`}>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-2xl dark:bg-sky-950/40">
              💬
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Buyer messages are managed in the Noon FBP Returns Portal</p>
              <p className="mt-1 text-xs text-slate-400">Open the portal to initiate or reply to order-level buyer messages.</p>
            </div>
            <a
              href="https://mp-partners-fbp-returns.noon.partners/en-ae?project=PRJ14351"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 dark:bg-sky-700 dark:hover:bg-sky-600"
            >
              Open Noon Messages ↗
            </a>
          </div>
        )
      )}
    </LogisticsShell>
  );
}

// Inline editable remark cell — saved on blur
function RemarkCell({ returnId, value }: { returnId: string; value: string | null }) {
  return (
    <input
      key={`${returnId}-${value}`}
      defaultValue={value ?? ""}
      placeholder="Add note…"
      onBlur={async (e) => {
        const v = e.target.value.trim();
        if (v !== (value ?? "")) {
          await db.from("noon_returns").update({ recon_remark: v || null }).eq("return_id", returnId);
        }
      }}
      className="w-full min-w-[140px] rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800"
    />
  );
}
