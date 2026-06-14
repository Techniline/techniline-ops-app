"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { fetchVendorPOs, syncVendorPOs, vendorPoLastSync, type VendorPORow } from "@/lib/spapi/vendorOrders";

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

function Content() {
  const [rows, setRows] = useState<VendorPORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
              <th className={thCell}>Type</th>
              <th className={thCell}>PO Date</th>
              <th className={thCell}>Items</th>
              <th className={thCell}>Ship-to</th>
              <th className={thCell}>Updated in Amazon</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className={tdCell} colSpan={7}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className={tdCell} colSpan={7}>No purchase orders yet — click <strong>Sync now</strong>.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={`${tdCell} font-medium`}>{r.po_number}</td>
                  <td className={tdCell}><StateBadge value={r.po_state} /></td>
                  <td className={tdCell}>{r.po_type ?? "—"}</td>
                  <td className={tdCell}>{fmt(r.po_date)}</td>
                  <td className={`${tdCell} tabular-nums`}>{r.item_count ?? 0}</td>
                  <td className={tdCell}>{r.ship_to_party ?? "—"}</td>
                  <td className={tdCell}>{fmt(r.state_changed_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">Status mirrors Vendor Central. Auto-syncs daily; use Sync now for an immediate refresh.</p>
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
