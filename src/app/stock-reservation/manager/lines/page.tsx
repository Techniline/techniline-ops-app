"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RouteGuard } from "@/components/RouteGuard";
import { fetchAllLinesWithAvailability, fetchImpos } from "@/lib/stock-reservation";
import type { Impo, ImpoLineWithAvailability } from "@/lib/stock-reservation";
import { supabase } from "@/lib/supabaseClient";

// ── ETA-based pastel palette ──────────────────────────────────────────────────

const PALETTES = [
  { dot: "bg-violet-500",   sectionBg: "bg-violet-50 border-violet-200",   accentStrip: "bg-violet-500",   impoChip: "bg-violet-100 text-violet-800 ring-violet-300",   etaText: "text-violet-600",   countChip: "bg-violet-100 text-violet-700",   cardBorder: "border-l-violet-400",   cardBg: "bg-violet-50/40",   brandText: "text-violet-500",   availBar: "bg-violet-400",   statPending: "text-violet-700",   navBg: "bg-violet-500",   navHover: "hover:bg-violet-600",   navRing: "ring-violet-300" },
  { dot: "bg-rose-500",     sectionBg: "bg-rose-50 border-rose-200",       accentStrip: "bg-rose-500",     impoChip: "bg-rose-100 text-rose-800 ring-rose-300",       etaText: "text-rose-600",     countChip: "bg-rose-100 text-rose-700",       cardBorder: "border-l-rose-400",     cardBg: "bg-rose-50/40",     brandText: "text-rose-500",     availBar: "bg-rose-400",     statPending: "text-rose-700",     navBg: "bg-rose-500",     navHover: "hover:bg-rose-600",     navRing: "ring-rose-300" },
  { dot: "bg-amber-500",    sectionBg: "bg-amber-50 border-amber-200",     accentStrip: "bg-amber-500",    impoChip: "bg-amber-100 text-amber-800 ring-amber-300",     etaText: "text-amber-600",    countChip: "bg-amber-100 text-amber-700",     cardBorder: "border-l-amber-400",    cardBg: "bg-amber-50/40",    brandText: "text-amber-600",    availBar: "bg-amber-400",    statPending: "text-amber-700",    navBg: "bg-amber-500",    navHover: "hover:bg-amber-600",    navRing: "ring-amber-300" },
  { dot: "bg-emerald-500",  sectionBg: "bg-emerald-50 border-emerald-200", accentStrip: "bg-emerald-500",  impoChip: "bg-emerald-100 text-emerald-800 ring-emerald-300", etaText: "text-emerald-600",  countChip: "bg-emerald-100 text-emerald-700", cardBorder: "border-l-emerald-400",  cardBg: "bg-emerald-50/40",  brandText: "text-emerald-600",  availBar: "bg-emerald-400",  statPending: "text-emerald-700",  navBg: "bg-emerald-500",  navHover: "hover:bg-emerald-600",  navRing: "ring-emerald-300" },
  { dot: "bg-sky-500",      sectionBg: "bg-sky-50 border-sky-200",         accentStrip: "bg-sky-500",      impoChip: "bg-sky-100 text-sky-800 ring-sky-300",         etaText: "text-sky-600",      countChip: "bg-sky-100 text-sky-700",         cardBorder: "border-l-sky-400",      cardBg: "bg-sky-50/40",      brandText: "text-sky-600",      availBar: "bg-sky-400",      statPending: "text-sky-700",      navBg: "bg-sky-500",      navHover: "hover:bg-sky-600",      navRing: "ring-sky-300" },
  { dot: "bg-indigo-500",   sectionBg: "bg-indigo-50 border-indigo-200",   accentStrip: "bg-indigo-500",   impoChip: "bg-indigo-100 text-indigo-800 ring-indigo-300",   etaText: "text-indigo-600",   countChip: "bg-indigo-100 text-indigo-700",   cardBorder: "border-l-indigo-400",   cardBg: "bg-indigo-50/40",   brandText: "text-indigo-500",   availBar: "bg-indigo-400",   statPending: "text-indigo-700",   navBg: "bg-indigo-500",   navHover: "hover:bg-indigo-600",   navRing: "ring-indigo-300" },
  { dot: "bg-teal-500",     sectionBg: "bg-teal-50 border-teal-200",       accentStrip: "bg-teal-500",     impoChip: "bg-teal-100 text-teal-800 ring-teal-300",       etaText: "text-teal-600",     countChip: "bg-teal-100 text-teal-700",       cardBorder: "border-l-teal-400",     cardBg: "bg-teal-50/40",     brandText: "text-teal-600",     availBar: "bg-teal-400",     statPending: "text-teal-700",     navBg: "bg-teal-500",     navHover: "hover:bg-teal-600",     navRing: "ring-teal-300" },
  { dot: "bg-fuchsia-500",  sectionBg: "bg-fuchsia-50 border-fuchsia-200", accentStrip: "bg-fuchsia-500",  impoChip: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-300", etaText: "text-fuchsia-600",  countChip: "bg-fuchsia-100 text-fuchsia-700", cardBorder: "border-l-fuchsia-400",  cardBg: "bg-fuchsia-50/40",  brandText: "text-fuchsia-500",  availBar: "bg-fuchsia-400",  statPending: "text-fuchsia-700",  navBg: "bg-fuchsia-500",  navHover: "hover:bg-fuchsia-600",  navRing: "ring-fuchsia-300" },
] as const;
type Palette = (typeof PALETTES)[number];

// ── Same-SKU combine within one IMPO ─────────────────────────────────────────

interface CombinedLine {
  id: string; allIds: string[];
  impo_id: string; brand: string | null; item_code: string;
  description: string | null; qty_incoming: number;
  qty_reserved: number; qty_available: number; impo: Impo;
}

function combineSameSkus(lines: ImpoLineWithAvailability[]): CombinedLine[] {
  const map = new Map<string, CombinedLine>();
  for (const l of lines) {
    const key = l.item_code.toLowerCase();
    const ex = map.get(key);
    if (ex) {
      ex.qty_incoming  += l.qty_incoming;
      ex.qty_reserved  += l.qty_reserved;
      ex.qty_available += l.qty_available;
      ex.allIds.push(l.id);
    } else {
      map.set(key, { id: l.id, allIds: [l.id], impo_id: l.impo_id, brand: l.brand,
        item_code: l.item_code, description: l.description, qty_incoming: l.qty_incoming,
        qty_reserved: l.qty_reserved, qty_available: l.qty_available, impo: l.impo });
    }
  }
  return Array.from(map.values());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "ETA TBC";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}
function fmtShortDate(d: string | null) {
  if (!d) return "TBC";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
  });
}
function impoStatusLabel(s: string) {
  return ({ pending: "Expected", in_transit: "In Transit", arrived: "Arrived", cancelled: "Cancelled" }[s]) ?? s;
}

// ── Stock card ────────────────────────────────────────────────────────────────

function StockCard({ line, palette, pendingMap }: { line: CombinedLine; palette: Palette; pendingMap: Map<string, number> }) {
  const pending = line.allIds.reduce((s, id) => s + (pendingMap.get(id) ?? 0), 0);
  const pct = line.qty_incoming > 0 ? Math.round((line.qty_available / line.qty_incoming) * 100) : 0;
  const soldOut = pct === 0;
  const low = !soldOut && pct < 25;
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-2xl border-l-4 border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md ${palette.cardBorder} ${palette.cardBg}`}>
      {low && <div className="absolute right-0 top-3 rounded-l-full bg-orange-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Low</div>}
      {soldOut && <div className="absolute right-0 top-3 rounded-l-full bg-red-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Full</div>}
      <div className="flex flex-1 flex-col p-4">
        <p className={`text-[11px] font-bold uppercase tracking-widest ${palette.brandText}`}>{line.brand ?? "—"}</p>
        <p className="mt-1 text-[17px] font-extrabold leading-tight text-slate-900">{line.item_code}</p>
        {line.description && <p className="mt-1.5 line-clamp-2 flex-1 text-[12px] leading-relaxed text-slate-500">{line.description}</p>}
      </div>
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all duration-500 ${soldOut ? "bg-red-400" : low ? "bg-orange-400" : palette.availBar}`} style={{ width: `${Math.max(pct, soldOut ? 0 : 3)}%` }} />
        </div>
        <div className="flex items-end justify-between gap-1">
          <div>
            <p className={`text-[13px] font-bold leading-none ${soldOut ? "text-red-500" : "text-slate-800"}`}>
              {line.qty_available} <span className="font-normal text-slate-400">of</span> {line.qty_incoming}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">available</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {line.qty_reserved > 0 && <span className="text-[11px] text-slate-400">{line.qty_reserved} reserved</span>}
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

function ImpoSectionHeader({ impo, palette, cardCount, totalAvail, totalIncoming, pendingCount }: {
  impo: Impo; palette: Palette; cardCount: number;
  totalAvail: number; totalIncoming: number; pendingCount: number;
}) {
  return (
    <div className={`mb-5 overflow-hidden rounded-2xl border ${palette.sectionBg}`}>
      <div className={`h-1.5 w-full ${palette.accentStrip}`} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
          </svg>
          <span className={`inline-flex items-center rounded-lg px-3 py-1 text-sm font-bold ring-1 ${palette.impoChip}`}>{impo.impo_number}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className={`text-sm font-semibold ${palette.etaText}`}>{fmtDate(impo.eta)}</span>
        </div>
        <span className="text-xs font-medium text-slate-500">{impoStatusLabel(impo.status)}</span>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${palette.countChip}`}>{cardCount} SKU{cardCount !== 1 ? "s" : ""}</span>
          <span className="text-xs text-slate-500"><span className="font-bold text-slate-700">{totalAvail}</span><span className="text-slate-400"> / {totalIncoming} avail</span></span>
          {pendingCount > 0 && <span className={`text-xs font-bold ${palette.statPending}`}>{pendingCount} pending</span>}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function LinesPage() {
  const searchParams = useSearchParams();
  const preselectedImpo = searchParams.get("impo") ?? "";

  const [lines,      setLines]      = useState<ImpoLineWithAvailability[]>([]);
  const [impos,      setImpos]      = useState<Impo[]>([]);
  const [pendingMap, setPendingMap] = useState<Map<string, number>>(new Map());
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [currentIdx, setCurrentIdx] = useState(0);
  const cardsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [l, i, p] = await Promise.all([
        fetchAllLinesWithAvailability(),
        fetchImpos(),
        sb.from("stock_reservations").select("impo_line_id, qty_requested").eq("status", "pending"),
      ]);
      setLines(l); setImpos(i);
      const map = new Map<string, number>();
      for (const r of (p.data ?? []) as { impo_line_id: string; qty_requested: number }[])
        map.set(r.impo_line_id, (map.get(r.impo_line_id) ?? 0) + r.qty_requested);
      setPendingMap(map);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Palette index by impo id (ETA order from fetchImpos)
  const paletteByImpoId = useMemo(() => {
    const m = new Map<string, number>();
    impos.forEach((imp, idx) => m.set(imp.id, idx % PALETTES.length));
    return m;
  }, [impos]);

  // All groups (no search/filter applied — full data)
  const allGroups = useMemo(() => {
    const order = new Map(impos.map((i, idx) => [i.id, idx]));
    const raw = new Map<string, { impo: Impo; lines: ImpoLineWithAvailability[] }>();
    for (const l of lines) {
      if (!raw.has(l.impo_id)) raw.set(l.impo_id, { impo: l.impo, lines: [] });
      raw.get(l.impo_id)!.lines.push(l);
    }
    return Array.from(raw.values())
      .sort((a, b) => (order.get(a.impo.id) ?? 999) - (order.get(b.impo.id) ?? 999))
      .map(({ impo, lines: raw }) => ({ impo, cards: combineSameSkus(raw) }));
  }, [lines, impos]);

  // Jump to preselected IMPO once groups are ready
  useEffect(() => {
    if (!preselectedImpo || allGroups.length === 0) return;
    const idx = allGroups.findIndex(g => g.impo.id === preselectedImpo);
    if (idx >= 0) setCurrentIdx(idx);
  }, [preselectedImpo, allGroups]);

  // Clamp currentIdx when groups change
  useEffect(() => {
    if (allGroups.length > 0) setCurrentIdx(i => Math.min(i, allGroups.length - 1));
  }, [allGroups.length]);

  // Search mode: filter across all groups
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return allGroups.map(({ impo, cards }) => ({
      impo, cards: cards.filter(c =>
        c.item_code.toLowerCase().includes(q) ||
        (c.brand ?? "").toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q)
      ),
    })).filter(g => g.cards.length > 0);
  }, [search, allGroups]);

  // Keyboard navigation (left / right arrows, not when typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (search || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowLeft")  goTo(currentIdx - 1);
      if (e.key === "ArrowRight") goTo(currentIdx + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function goTo(idx: number) {
    const clamped = Math.max(0, Math.min(idx, allGroups.length - 1));
    setCurrentIdx(clamped);
    setTimeout(() => cardsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const current = allGroups[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast  = currentIdx === allGroups.length - 1;

  const totalSkus  = allGroups.reduce((s, g) => s + g.cards.length, 0);
  const totalAvail = allGroups.reduce((s, g) => s + g.cards.reduce((a, c) => a + c.qty_available, 0), 0);
  const totalPend  = allGroups.reduce((s, g) => s + g.cards.reduce((a, c) => a + c.allIds.reduce((b, id) => b + (pendingMap.get(id) ?? 0), 0), 0), 0);

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

      {/* Header row: title + colour legend */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Browse Stock</h1>
          <p className="mt-1 text-sm text-slate-500">All incoming SKUs — availability and pending reservations.</p>
        </div>

        {/* Colour legend — one pill per IMPO, clickable to jump */}
        {!loading && allGroups.length > 0 && (
          <div className="flex flex-col items-end gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Shipments by arrival order
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {allGroups.map((g, idx) => {
                const p = PALETTES[paletteByImpoId.get(g.impo.id) ?? 0];
                const isActive = !searchResults && idx === currentIdx;
                return (
                  <button
                    key={g.impo.id}
                    onClick={() => { setSearch(""); goTo(idx); }}
                    title={`${g.impo.impo_number} — ETA ${fmtDate(g.impo.eta)}`}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-all duration-150 ${p.impoChip} ${isActive ? "scale-105 ring-2 shadow-md" : "opacity-60 hover:opacity-100 hover:scale-105"}`}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.dot}`} />
                    {g.impo.impo_number}
                    <span className="opacity-70">· {fmtShortDate(g.impo.eta)}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400">Click a pill to jump · ← → keys to navigate</p>
          </div>
        )}
      </div>

      {/* Summary strip */}
      {!loading && allGroups.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
          <Stat label="shipments"         value={allGroups.length} />
          <Stat label="SKUs"              value={totalSkus} />
          <Stat label="units available"   value={totalAvail} color="text-emerald-600" />
          {totalPend > 0 && <Stat label="pending" value={totalPend} color="text-amber-600" />}
        </div>
      )}

      {/* Search bar */}
      <div className="mb-5">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text" placeholder="Search SKU, brand, description…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-10 text-sm shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400">
          <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>

      ) : searchResults ? (
        /* ── Search results mode ── */
        <div>
          <p className="mb-4 text-sm text-slate-500">
            <span className="font-semibold text-slate-800">{searchResults.reduce((s, g) => s + g.cards.length, 0)}</span> result{searchResults.reduce((s, g) => s + g.cards.length, 0) !== 1 ? "s" : ""} across {searchResults.length} shipment{searchResults.length !== 1 ? "s" : ""}
          </p>
          {searchResults.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center text-slate-400">No SKUs match "{search}".</div>
          ) : (
            <div className="space-y-10">
              {searchResults.map(({ impo, cards }) => {
                const palette = PALETTES[paletteByImpoId.get(impo.id) ?? 0];
                const gAvail = cards.reduce((s, c) => s + c.qty_available, 0);
                const gTotal = cards.reduce((s, c) => s + c.qty_incoming, 0);
                const gPend  = cards.reduce((s, c) => s + c.allIds.reduce((b, id) => b + (pendingMap.get(id) ?? 0), 0), 0);
                return (
                  <div key={impo.id}>
                    <ImpoSectionHeader impo={impo} palette={palette} cardCount={cards.length} totalAvail={gAvail} totalIncoming={gTotal} pendingCount={gPend} />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {cards.map(c => <StockCard key={c.id} line={c} palette={palette} pendingMap={pendingMap} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      ) : allGroups.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center text-slate-400">No incoming stock loaded yet.</div>

      ) : (
        /* ── Paginated IMPO view ── */
        <div>
          {/* Navigation bar */}
          <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-stretch">

              {/* Prev button */}
              <button
                onClick={() => goTo(currentIdx - 1)} disabled={isFirst}
                className={`group flex min-w-0 flex-1 flex-col items-start gap-1 border-r border-slate-100 px-5 py-4 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30 ${isFirst ? "" : ""}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 group-hover:text-slate-600">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                  Previous
                </div>
                {!isFirst && (() => {
                  const prev = allGroups[currentIdx - 1];
                  const pp   = PALETTES[paletteByImpoId.get(prev.impo.id) ?? 0];
                  return (
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${pp.dot}`} />
                      <span className="truncate text-sm font-bold text-slate-700">{prev.impo.impo_number}</span>
                      <span className="shrink-0 text-xs text-slate-400">{fmtShortDate(prev.impo.eta)}</span>
                    </div>
                  );
                })()}
              </button>

              {/* Centre: dot indicators */}
              <div className="flex shrink-0 flex-col items-center justify-center gap-2 px-6 py-4">
                <div className="flex items-center gap-2">
                  {allGroups.map((g, idx) => {
                    const pp = PALETTES[paletteByImpoId.get(g.impo.id) ?? 0];
                    const isActive = idx === currentIdx;
                    return (
                      <button
                        key={g.impo.id}
                        onClick={() => goTo(idx)}
                        title={g.impo.impo_number}
                        className={`rounded-full transition-all duration-200 ${pp.dot} ${isActive ? "h-3 w-8 shadow" : "h-2.5 w-2.5 opacity-30 hover:opacity-60"}`}
                      />
                    );
                  })}
                </div>
                <p className="text-[11px] font-semibold text-slate-400">
                  {currentIdx + 1} of {allGroups.length}
                </p>
              </div>

              {/* Next button */}
              <button
                onClick={() => goTo(currentIdx + 1)} disabled={isLast}
                className="group flex min-w-0 flex-1 flex-col items-end gap-1 border-l border-slate-100 px-5 py-4 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 group-hover:text-slate-600">
                  Next
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                {!isLast && (() => {
                  const next = allGroups[currentIdx + 1];
                  const np   = PALETTES[paletteByImpoId.get(next.impo.id) ?? 0];
                  return (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-xs text-slate-400">{fmtShortDate(next.impo.eta)}</span>
                      <span className="truncate text-sm font-bold text-slate-700">{next.impo.impo_number}</span>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${np.dot}`} />
                    </div>
                  );
                })()}
              </button>
            </div>
          </div>

          {/* Current IMPO cards */}
          {current && (() => {
            const palette = PALETTES[paletteByImpoId.get(current.impo.id) ?? 0];
            const gAvail  = current.cards.reduce((s, c) => s + c.qty_available, 0);
            const gTotal  = current.cards.reduce((s, c) => s + c.qty_incoming, 0);
            const gPend   = current.cards.reduce((s, c) => s + c.allIds.reduce((b, id) => b + (pendingMap.get(id) ?? 0), 0), 0);
            return (
              <div ref={cardsRef}>
                <ImpoSectionHeader impo={current.impo} palette={palette} cardCount={current.cards.length} totalAvail={gAvail} totalIncoming={gTotal} pendingCount={gPend} />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {current.cards.map(c => <StockCard key={c.id} line={c} palette={palette} pendingMap={pendingMap} />)}
                </div>

                {/* Bottom nav (mirrors top) */}
                <div className="mt-8 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <button onClick={() => goTo(currentIdx - 1)} disabled={isFirst}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-30">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                    {isFirst ? "First shipment" : allGroups[currentIdx - 1].impo.impo_number}
                  </button>
                  <p className="text-sm font-semibold text-slate-400">{currentIdx + 1} / {allGroups.length}</p>
                  <button onClick={() => goTo(currentIdx + 1)} disabled={isLast}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-30">
                    {isLast ? "Last shipment" : allGroups[currentIdx + 1].impo.impo_number}
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-xl font-extrabold ${color ?? "text-slate-900"}`}>{value.toLocaleString()}</span>
      <span className="text-sm text-slate-400">{label}</span>
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
