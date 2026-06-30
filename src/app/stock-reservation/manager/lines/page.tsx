"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RouteGuard } from "@/components/RouteGuard";
import { fetchAllLinesWithAvailability, fetchImpos } from "@/lib/stock-reservation";
import type { Impo, ImpoLineWithAvailability } from "@/lib/stock-reservation";
import { supabase } from "@/lib/supabaseClient";

// ── ETA-based pastel palette (8 colours, cycles) ─────────────────────────────
// All class strings are complete — no dynamic construction — so Tailwind picks them up.

const PALETTES = [
  {
    // Violet — earliest ETA / most urgent
    sectionBg:     "bg-violet-50 border-violet-200",
    accentStrip:   "bg-violet-500",
    impoChip:      "bg-violet-100 text-violet-800 ring-violet-200",
    etaText:       "text-violet-600",
    countChip:     "bg-violet-100 text-violet-700",
    cardBorder:    "border-l-violet-400",
    cardBg:        "bg-violet-50/40",
    brandText:     "text-violet-500",
    availBar:      "bg-violet-400",
    statPending:   "text-violet-700",
  },
  {
    // Rose
    sectionBg:     "bg-rose-50 border-rose-200",
    accentStrip:   "bg-rose-500",
    impoChip:      "bg-rose-100 text-rose-800 ring-rose-200",
    etaText:       "text-rose-600",
    countChip:     "bg-rose-100 text-rose-700",
    cardBorder:    "border-l-rose-400",
    cardBg:        "bg-rose-50/40",
    brandText:     "text-rose-500",
    availBar:      "bg-rose-400",
    statPending:   "text-rose-700",
  },
  {
    // Amber
    sectionBg:     "bg-amber-50 border-amber-200",
    accentStrip:   "bg-amber-500",
    impoChip:      "bg-amber-100 text-amber-800 ring-amber-200",
    etaText:       "text-amber-600",
    countChip:     "bg-amber-100 text-amber-700",
    cardBorder:    "border-l-amber-400",
    cardBg:        "bg-amber-50/40",
    brandText:     "text-amber-600",
    availBar:      "bg-amber-400",
    statPending:   "text-amber-700",
  },
  {
    // Emerald
    sectionBg:     "bg-emerald-50 border-emerald-200",
    accentStrip:   "bg-emerald-500",
    impoChip:      "bg-emerald-100 text-emerald-800 ring-emerald-200",
    etaText:       "text-emerald-600",
    countChip:     "bg-emerald-100 text-emerald-700",
    cardBorder:    "border-l-emerald-400",
    cardBg:        "bg-emerald-50/40",
    brandText:     "text-emerald-600",
    availBar:      "bg-emerald-400",
    statPending:   "text-emerald-700",
  },
  {
    // Sky
    sectionBg:     "bg-sky-50 border-sky-200",
    accentStrip:   "bg-sky-500",
    impoChip:      "bg-sky-100 text-sky-800 ring-sky-200",
    etaText:       "text-sky-600",
    countChip:     "bg-sky-100 text-sky-700",
    cardBorder:    "border-l-sky-400",
    cardBg:        "bg-sky-50/40",
    brandText:     "text-sky-600",
    availBar:      "bg-sky-400",
    statPending:   "text-sky-700",
  },
  {
    // Indigo
    sectionBg:     "bg-indigo-50 border-indigo-200",
    accentStrip:   "bg-indigo-500",
    impoChip:      "bg-indigo-100 text-indigo-800 ring-indigo-200",
    etaText:       "text-indigo-600",
    countChip:     "bg-indigo-100 text-indigo-700",
    cardBorder:    "border-l-indigo-400",
    cardBg:        "bg-indigo-50/40",
    brandText:     "text-indigo-500",
    availBar:      "bg-indigo-400",
    statPending:   "text-indigo-700",
  },
  {
    // Teal
    sectionBg:     "bg-teal-50 border-teal-200",
    accentStrip:   "bg-teal-500",
    impoChip:      "bg-teal-100 text-teal-800 ring-teal-200",
    etaText:       "text-teal-600",
    countChip:     "bg-teal-100 text-teal-700",
    cardBorder:    "border-l-teal-400",
    cardBg:        "bg-teal-50/40",
    brandText:     "text-teal-600",
    availBar:      "bg-teal-400",
    statPending:   "text-teal-700",
  },
  {
    // Fuchsia
    sectionBg:     "bg-fuchsia-50 border-fuchsia-200",
    accentStrip:   "bg-fuchsia-500",
    impoChip:      "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200",
    etaText:       "text-fuchsia-600",
    countChip:     "bg-fuchsia-100 text-fuchsia-700",
    cardBorder:    "border-l-fuchsia-400",
    cardBg:        "bg-fuchsia-50/40",
    brandText:     "text-fuchsia-500",
    availBar:      "bg-fuchsia-400",
    statPending:   "text-fuchsia-700",
  },
] as const;

type Palette = (typeof PALETTES)[number];

// ── Combined line (same SKU within same IMPO merged) ──────────────────────────

interface CombinedLine {
  id: string;
  allIds: string[];
  impo_id: string;
  brand: string | null;
  item_code: string;
  description: string | null;
  qty_incoming: number;
  qty_reserved: number;
  qty_available: number;
  impo: Impo;
}

function combineSameSkus(lines: ImpoLineWithAvailability[]): CombinedLine[] {
  const map = new Map<string, CombinedLine>();
  for (const l of lines) {
    const key = l.item_code.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.qty_incoming  += l.qty_incoming;
      existing.qty_reserved  += l.qty_reserved;
      existing.qty_available += l.qty_available;
      existing.allIds.push(l.id);
    } else {
      map.set(key, {
        id: l.id, allIds: [l.id],
        impo_id: l.impo_id, brand: l.brand, item_code: l.item_code,
        description: l.description, qty_incoming: l.qty_incoming,
        qty_reserved: l.qty_reserved, qty_available: l.qty_available,
        impo: l.impo,
      });
    }
  }
  return Array.from(map.values());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function impoStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending:    "Expected",
    in_transit: "In Transit",
    arrived:    "Arrived",
    cancelled:  "Cancelled",
  };
  return map[status] ?? status;
}

// ── Stock card ────────────────────────────────────────────────────────────────

interface StockCardProps {
  line: CombinedLine;
  palette: Palette;
  pendingMap: Map<string, number>;
}

function StockCard({ line, palette, pendingMap }: StockCardProps) {
  const pending = line.allIds.reduce((s, id) => s + (pendingMap.get(id) ?? 0), 0);
  const pct = line.qty_incoming > 0 ? Math.round((line.qty_available / line.qty_incoming) * 100) : 0;
  const soldOut = pct === 0;
  const almostGone = !soldOut && pct < 25;

  return (
    <div className={`group relative flex flex-col overflow-hidden rounded-2xl border-l-4 border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md ${palette.cardBorder} ${palette.cardBg}`}>
      {/* Low-stock ribbon */}
      {almostGone && !soldOut && (
        <div className="absolute right-0 top-3 rounded-l-full bg-orange-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
          Low
        </div>
      )}
      {soldOut && (
        <div className="absolute right-0 top-3 rounded-l-full bg-red-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
          Full
        </div>
      )}

      <div className="flex flex-1 flex-col p-4">
        <p className={`text-[11px] font-bold uppercase tracking-widest ${palette.brandText}`}>
          {line.brand ?? "—"}
        </p>
        <p className="mt-1 text-[17px] font-extrabold leading-tight text-slate-900">
          {line.item_code}
        </p>
        {line.description && (
          <p className="mt-1.5 line-clamp-2 flex-1 text-[12px] leading-relaxed text-slate-500">
            {line.description}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-100 px-4 py-3">
        {/* Availability bar */}
        <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${soldOut ? "bg-red-400" : almostGone ? "bg-orange-400" : palette.availBar}`}
            style={{ width: `${Math.max(pct, soldOut ? 0 : 3)}%` }}
          />
        </div>

        <div className="flex items-end justify-between gap-1">
          <div>
            <p className={`text-[13px] font-bold leading-none ${soldOut ? "text-red-500" : "text-slate-800"}`}>
              {line.qty_available} <span className="font-normal text-slate-400">of</span> {line.qty_incoming}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">available</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {line.qty_reserved > 0 && (
              <span className="text-[11px] text-slate-400">{line.qty_reserved} reserved</span>
            )}
            {pending > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
                {pending} pending
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── IMPO section header ───────────────────────────────────────────────────────

interface ImpoSectionHeaderProps {
  impo: Impo;
  palette: Palette;
  cardCount: number;
  totalAvail: number;
  totalIncoming: number;
  pendingCount: number;
}

function ImpoSectionHeader({ impo, palette, cardCount, totalAvail, totalIncoming, pendingCount }: ImpoSectionHeaderProps) {
  return (
    <div className={`mb-4 overflow-hidden rounded-2xl border ${palette.sectionBg}`}>
      {/* Coloured top strip */}
      <div className={`h-1.5 w-full ${palette.accentStrip}`} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
        {/* IMPO chip */}
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
          </svg>
          <span className={`inline-flex items-center rounded-lg px-3 py-1 text-sm font-bold ring-1 ${palette.impoChip}`}>
            {impo.impo_number}
          </span>
        </div>

        {/* ETA */}
        <div className="flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className={`text-sm font-semibold ${palette.etaText}`}>
            {impo.eta ? fmtDate(impo.eta) : "ETA TBC"}
          </span>
        </div>

        {/* Status */}
        <span className="text-xs font-medium text-slate-500">{impoStatusLabel(impo.status)}</span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats */}
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${palette.countChip}`}>
            {cardCount} SKU{cardCount !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-slate-500">
            <span className="font-bold text-slate-700">{totalAvail}</span>
            <span className="text-slate-400"> / {totalIncoming} avail</span>
          </span>
          {pendingCount > 0 && (
            <span className={`text-xs font-bold ${palette.statPending}`}>
              {pendingCount} pending
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

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
        sb.from("stock_reservations").select("impo_line_id, qty_requested").eq("status", "pending"),
      ]);
      setLines(l);
      setImpos(i);
      const map = new Map<string, number>();
      for (const r of (pending.data ?? []) as { impo_line_id: string; qty_requested: number }[]) {
        map.set(r.impo_line_id, (map.get(r.impo_line_id) ?? 0) + r.qty_requested);
      }
      setPendingMap(map);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFilterImpo(preselectedImpo); }, [preselectedImpo]);

  // ETA-sorted IMPO → palette index (stable, based on impos[] order from fetchImpos)
  const paletteByImpoId = useMemo(() => {
    const m = new Map<string, number>();
    impos.forEach((imp, idx) => m.set(imp.id, idx % PALETTES.length));
    return m;
  }, [impos]);

  // Group by IMPO, apply combine-same-SKU within each group, filter by search + impo filter
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const order = new Map(impos.map((i, idx) => [i.id, idx]));

    const raw = new Map<string, { impo: Impo; lines: ImpoLineWithAvailability[] }>();
    for (const l of lines) {
      if (filterImpo && l.impo_id !== filterImpo) continue;
      if (!raw.has(l.impo_id)) raw.set(l.impo_id, { impo: l.impo, lines: [] });
      raw.get(l.impo_id)!.lines.push(l);
    }

    return Array.from(raw.values())
      .sort((a, b) => (order.get(a.impo.id) ?? 999) - (order.get(b.impo.id) ?? 999))
      .map(({ impo, lines: rawLines }) => {
        const combined = combineSameSkus(rawLines).filter((c) => {
          if (!q) return true;
          return (
            c.item_code.toLowerCase().includes(q) ||
            (c.brand ?? "").toLowerCase().includes(q) ||
            (c.description ?? "").toLowerCase().includes(q)
          );
        });
        return { impo, cards: combined };
      })
      .filter(({ cards }) => cards.length > 0);
  }, [lines, impos, filterImpo, search]);

  const totalSkus    = grouped.reduce((s, g) => s + g.cards.length, 0);
  const totalAvail   = grouped.reduce((s, g) => s + g.cards.reduce((a, c) => a + c.qty_available, 0), 0);
  const totalPending = grouped.reduce((s, g) => s + g.cards.reduce((a, c) => a + c.allIds.reduce((b, id) => b + (pendingMap.get(id) ?? 0), 0), 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 md:p-6">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/dashboard" className="hover:text-slate-600">Dashboard</Link>
        <span>/</span>
        <Link href="/stock-reservation/manager" className="hover:text-slate-600">Manager</Link>
        <span>/</span>
        <span className="text-slate-600">Browse Stock</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Browse Stock</h1>
        <p className="mt-1 text-sm text-slate-500">All incoming SKUs across open IMPOs — availability and pending reservations.</p>
      </div>

      {/* Summary strip */}
      {!loading && grouped.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-extrabold text-slate-900">{grouped.length}</span>
            <span className="text-sm text-slate-400">shipment{grouped.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-extrabold text-slate-900">{totalSkus}</span>
            <span className="text-sm text-slate-400">SKUs</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-extrabold text-emerald-600">{totalAvail}</span>
            <span className="text-sm text-slate-400">units available</span>
          </div>
          {totalPending > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-extrabold text-amber-600">{totalPending}</span>
              <span className="text-sm text-slate-400">pending reservations</span>
            </div>
          )}
          {(search || filterImpo) && (
            <button onClick={() => { setSearch(""); setFilterImpo(""); }}
              className="ml-auto self-center text-xs font-medium text-slate-400 hover:text-red-500">
              Clear filters ✕
            </button>
          )}
        </div>
      )}

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
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm shadow-sm ring-0 transition focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select
          value={filterImpo}
          onChange={(e) => setFilterImpo(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-300 focus:outline-none"
        >
          <option value="">All ETAs</option>
          {impos.map((i) => (
            <option key={i.id} value={i.id}>
              {i.impo_number}{i.eta ? ` · ${fmtDate(i.eta)}` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400">
          <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center text-slate-400 shadow-sm">
          {search || filterImpo ? "No SKUs match the current filters." : "No incoming stock loaded yet."}
        </div>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ impo, cards }) => {
            const palette = PALETTES[paletteByImpoId.get(impo.id) ?? 0];
            const totalAvailInGroup   = cards.reduce((s, c) => s + c.qty_available, 0);
            const totalIncomingInGroup = cards.reduce((s, c) => s + c.qty_incoming, 0);
            const pendingInGroup       = cards.reduce((s, c) => s + c.allIds.reduce((b, id) => b + (pendingMap.get(id) ?? 0), 0), 0);
            return (
              <div key={impo.id}>
                <ImpoSectionHeader
                  impo={impo}
                  palette={palette}
                  cardCount={cards.length}
                  totalAvail={totalAvailInGroup}
                  totalIncoming={totalIncomingInGroup}
                  pendingCount={pendingInGroup}
                />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {cards.map((card) => (
                    <StockCard key={card.id} line={card} palette={palette} pendingMap={pendingMap} />
                  ))}
                </div>
              </div>
            );
          })}
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
