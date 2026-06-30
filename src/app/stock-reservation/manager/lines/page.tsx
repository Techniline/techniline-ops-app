"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RouteGuard } from "@/components/RouteGuard";
import { fetchAllLinesWithAvailability, fetchImpos } from "@/lib/stock-reservation";
import type { Impo, ImpoLineWithAvailability } from "@/lib/stock-reservation";
import { supabase } from "@/lib/supabaseClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ── Pending badge (live from Supabase) ────────────────────────────────────────

interface PendingBadgeProps { lineId: string; pendingMap: Map<string, number> }
function PendingBadge({ lineId, pendingMap }: PendingBadgeProps) {
  const count = pendingMap.get(lineId) ?? 0;
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
      {count} pending
    </span>
  );
}

// ── Stock card ────────────────────────────────────────────────────────────────

interface StockCardProps {
  line: ImpoLineWithAvailability;
  pendingMap: Map<string, number>;
}

function StockCard({ line, pendingMap }: StockCardProps) {
  const pct = line.qty_incoming > 0 ? Math.round((line.qty_available / line.qty_incoming) * 100) : 0;
  const barColor =
    pct === 0 ? "bg-red-400" :
    pct < 30  ? "bg-amber-400" :
                "bg-green-500";

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{line.brand ?? "—"}</p>
      <p className="mt-1 text-lg font-bold leading-tight text-slate-900 dark:text-slate-100">{line.item_code}</p>
      <p className="mt-0.5 text-xs text-slate-400">
        {line.impo.impo_number} · {fmtDate(line.impo.eta)}
      </p>
      {line.description && (
        <p className="mt-2 line-clamp-2 flex-1 text-sm text-slate-500">{line.description}</p>
      )}

      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <p className={`text-sm font-semibold ${pct === 0 ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}>
            {line.qty_available} of {line.qty_incoming} available
          </p>
          <PendingBadge lineId={line.id} pendingMap={pendingMap} />
        </div>
        {line.qty_reserved > 0 && (
          <p className="mt-0.5 text-xs text-slate-400">{line.qty_reserved} reserved</p>
        )}
      </div>
    </div>
  );
}

// ── Main lines browse page ────────────────────────────────────────────────────

function LinesPage() {
  const searchParams = useSearchParams();
  const preselectedImpo = searchParams.get("impo") ?? "";

  const [lines, setLines] = useState<ImpoLineWithAvailability[]>([]);
  const [impos, setImpos] = useState<Impo[]>([]);
  const [pendingMap, setPendingMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterImpo, setFilterImpo] = useState(preselectedImpo);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [l, i, pending] = await Promise.all([
        fetchAllLinesWithAvailability(),
        fetchImpos(),
        sb
          .from("stock_reservations")
          .select("impo_line_id, qty_requested")
          .eq("status", "pending"),
      ]);
      setLines(l);
      setImpos(i);
      const map = new Map<string, number>();
      for (const r of (pending.data ?? []) as { impo_line_id: string; qty_requested: number }[]) {
        map.set(r.impo_line_id, (map.get(r.impo_line_id) ?? 0) + r.qty_requested);
      }
      setPendingMap(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // If the URL ?impo= changes (e.g. navigating back from a specific IMPO), sync the filter
  useEffect(() => { setFilterImpo(preselectedImpo); }, [preselectedImpo]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return lines.filter((l) => {
      if (filterImpo && l.impo_id !== filterImpo) return false;
      if (q && !(
        l.item_code.toLowerCase().includes(q) ||
        (l.brand ?? "").toLowerCase().includes(q) ||
        (l.description ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [lines, filterImpo, search]);

  // Group by IMPO, preserving ETA sort order from fetchImpos
  const grouped = useMemo(() => {
    const order = new Map(impos.map((i, idx) => [i.id, idx]));
    const map = new Map<string, { impo: Impo; lines: ImpoLineWithAvailability[] }>();
    for (const l of filtered) {
      if (!map.has(l.impo_id)) map.set(l.impo_id, { impo: l.impo, lines: [] });
      map.get(l.impo_id)!.lines.push(l);
    }
    return Array.from(map.values()).sort(
      (a, b) => (order.get(a.impo.id) ?? 999) - (order.get(b.impo.id) ?? 999)
    );
  }, [filtered, impos]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950 md:p-6">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/dashboard" className="hover:text-slate-600 dark:hover:text-slate-200">Dashboard</Link>
        <span>/</span>
        <Link href="/stock-reservation/manager" className="hover:text-slate-600 dark:hover:text-slate-200">Manager</Link>
        <span>/</span>
        <span className="text-slate-600 dark:text-slate-300">Browse Stock</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Browse Stock</h1>
        <p className="mt-1 text-sm text-slate-500">All incoming SKUs across open IMPOs — availability and pending reservations.</p>
      </div>

      {/* Search + IMPO filter */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search SKU, brand, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <select
          value={filterImpo}
          onChange={(e) => setFilterImpo(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">All ETAs</option>
          {impos.map((i) => (
            <option key={i.id} value={i.id}>
              {i.impo_number}{i.eta ? ` · ${fmtDate(i.eta)}` : ""}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400">
          <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          {search || filterImpo ? "No SKUs match the current filters." : "No incoming stock loaded yet."}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ impo, lines: impoLines }) => (
            <div key={impo.id}>
              {/* IMPO section header */}
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
                  </svg>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{impo.impo_number}</span>
                  {impo.eta && <span className="text-sm text-slate-400">ETA: {fmtDate(impo.eta)}</span>}
                </div>
                <span className="text-sm text-slate-400">{impoLines.length} SKU{impoLines.length !== 1 ? "s" : ""}</span>
              </div>

              {/* Card grid */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {impoLines.map((line) => (
                  <StockCard key={line.id} line={line} pendingMap={pendingMap} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <RouteGuard requireCapability="stock_reservation_manager">
      <LinesPage />
    </RouteGuard>
  );
}
