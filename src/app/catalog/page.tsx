"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabaseClient";

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

interface CatalogItem {
  itemCode: string;
  itemDesc: string;
  unit: string;
  price: number;
  priceType: string;
  taxCode: string;
  taxPct: number;
  stockQty: number;
  availableQty: number;
  reservedQty: number;
  onOrderQty: number;
}

function fmt(n: number) {
  return n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "in" | "out">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/acsys/catalog", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as {
        ok: boolean;
        configured?: boolean;
        items?: CatalogItem[];
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "Failed to load catalog.");
      if (json.configured === false) {
        setConfigured(false);
        return;
      }
      setItems(json.items ?? []);
      setLastFetched(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.itemCode.toLowerCase().includes(q) && !item.itemDesc.toLowerCase().includes(q)) return false;
      if (stockFilter === "in" && item.availableQty <= 0) return false;
      if (stockFilter === "out" && item.availableQty > 0) return false;
      return true;
    });
  }, [items, search, stockFilter]);

  if (!configured) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
        <p className="text-sm">acSysERP is not configured.</p>
        <p className="text-xs">Set ACSYS_BASE_URL, ACSYS_CID, ACSYS_USERNAME, and ACSYS_PASSWORD in Vercel environment variables.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">ERP Product Catalog</h1>
          {lastFetched && (
            <p className="text-xs text-slate-400">
              Updated {lastFetched.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search item code or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          {(["all", "in", "out"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStockFilter(f)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                stockFilter === f
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
              }`}
            >
              {f === "all" ? "All" : f === "in" ? "In Stock" : "Out of Stock"}
            </button>
          ))}
        </div>
        {!loading && (
          <span className="text-xs text-slate-400">
            {filtered.length} of {items.length} items
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && items.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      )}

      {/* Table */}
      {!loading && filtered.length === 0 && !error ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-400">
          {items.length === 0 ? "No items loaded." : "No items match your search."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                <th className="px-4 py-3 text-left">Item Code</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-center">Unit</th>
                <th className="px-4 py-3 text-right">Price (AED)</th>
                <th className="px-4 py-3 text-center">Tax</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3 text-right">Reserved</th>
                <th className="px-4 py-3 text-right">On Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((item) => (
                <tr
                  key={item.itemCode}
                  className="bg-white transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                    {item.itemCode}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                    {item.itemDesc}
                  </td>
                  <td className="px-4 py-2.5 text-center text-slate-500">{item.unit}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
                    {fmt(item.price)}
                  </td>
                  <td className="px-4 py-2.5 text-center text-slate-500">
                    {item.taxCode} ({item.taxPct}%)
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span
                      className={`font-semibold ${
                        item.availableQty > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-500 dark:text-red-400"
                      }`}
                    >
                      {item.availableQty.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-400">
                    {item.reservedQty > 0 ? item.reservedQty.toLocaleString() : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-sky-600 dark:text-sky-400">
                    {item.onOrderQty > 0 ? item.onOrderQty.toLocaleString() : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
