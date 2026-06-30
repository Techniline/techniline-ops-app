"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { RouteGuard } from "@/components/RouteGuard";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchAllLinesWithAvailability,
  fetchMyReservations,
} from "@/lib/stock-reservation";
import type { ImpoLineWithAvailability, StockReservation } from "@/lib/stock-reservation";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending:   "bg-amber-100 text-amber-700",
    approved:  "bg-green-100 text-green-700",
    rejected:  "bg-red-100 text-red-700",
    cancelled: "bg-slate-100 text-slate-500",
  };
  return map[status] ?? "bg-slate-100 text-slate-500";
}

// ── Reserve Modal ─────────────────────────────────────────────────────────────

interface ReserveModalProps {
  line: ImpoLineWithAvailability;
  onClose: () => void;
  onSuccess: () => void;
  token: string;
}

function ReserveModal({ line, onClose, onSuccess, token }: ReserveModalProps) {
  const [qty, setQty] = useState(1);
  const [customerRef, setCustomerRef] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-reservation/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ impo_line_id: line.id, qty_requested: qty, customer_ref: customerRef.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Failed."); return; }
      onSuccess();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Reserve Stock</h2>
        <p className="mb-4 text-sm text-slate-500">
          {line.item_code} · {line.description ?? "—"} · IMPO {line.impo.impo_number} · ETA {fmtDate(line.impo.eta)}
        </p>

        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Available</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{line.qty_available} <span className="text-sm font-normal text-slate-500">of {line.qty_incoming}</span></p>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Quantity to Reserve</span>
          <input
            type="number"
            min={1}
            max={line.qty_available}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(line.qty_available, Number(e.target.value))))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Customer / Project Reference</span>
          <input
            type="text"
            placeholder="e.g. Al Futtaim Project"
            value={customerRef}
            onChange={(e) => setCustomerRef(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Notes (optional)</span>
          <textarea
            rows={2}
            placeholder="Any additional context…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || qty < 1 || qty > line.qty_available}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sold-out prompt: suggest next IMPO ────────────────────────────────────────

interface SoldOutPromptProps {
  itemCode: string;
  currentImpo: string;
  nextLine: ImpoLineWithAvailability | null;
  onClose: () => void;
  onReserveNext: (line: ImpoLineWithAvailability) => void;
}

function SoldOutPrompt({ itemCode, currentImpo, nextLine, onClose, onReserveNext }: SoldOutPromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
        </div>
        <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          {itemCode} is fully reserved in {currentImpo}
        </h2>
        {nextLine ? (
          <>
            <p className="mb-4 text-sm text-slate-500">
              {nextLine.qty_available} unit{nextLine.qty_available !== 1 ? "s" : ""} available in <strong>{nextLine.impo.impo_number}</strong> (ETA: {fmtDate(nextLine.impo.eta)})
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
              <button
                onClick={() => onReserveNext(nextLine)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Reserve from {fmtDate(nextLine.impo.eta)}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">No other incoming shipment has this item. Contact Grace to arrange a new order.</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function StockReservationPage() {
  const { profile } = useAuth();
  const [token, setToken] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? "");
    });
  }, []);

  const [lines, setLines] = useState<ImpoLineWithAvailability[]>([]);
  const [myReservations, setMyReservations] = useState<StockReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterEta, setFilterEta] = useState<string>("all");

  const [reservingLine, setReservingLine] = useState<ImpoLineWithAvailability | null>(null);
  const [soldOutLine, setSoldOutLine] = useState<ImpoLineWithAvailability | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [l, r] = await Promise.all([
        fetchAllLinesWithAvailability(),
        fetchMyReservations(profile.id),
      ]);
      setLines(l);
      setMyReservations(r);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  // Group lines by ETA date
  const allEtas = useMemo(() => {
    const seen = new Set<string>();
    for (const l of lines) if (l.impo.eta) seen.add(l.impo.eta);
    return Array.from(seen).sort();
  }, [lines]);

  const filteredLines = useMemo(() => {
    const q = search.toLowerCase();
    return lines.filter((l) => {
      if (filterEta !== "all" && l.impo.eta !== filterEta) return false;
      if (!q) return true;
      return (
        l.item_code.toLowerCase().includes(q) ||
        (l.description ?? "").toLowerCase().includes(q) ||
        (l.brand ?? "").toLowerCase().includes(q) ||
        (l.category ?? "").toLowerCase().includes(q) ||
        l.impo.impo_number.toLowerCase().includes(q)
      );
    });
  }, [lines, search, filterEta]);

  // Group by impo_id then eta
  const grouped = useMemo(() => {
    const map = new Map<string, { impoNumber: string; eta: string; lines: ImpoLineWithAvailability[] }>();
    for (const l of filteredLines) {
      if (!map.has(l.impo_id)) map.set(l.impo_id, { impoNumber: l.impo.impo_number, eta: l.impo.eta, lines: [] });
      map.get(l.impo_id)!.lines.push(l);
    }
    return Array.from(map.values()).sort((a, b) => a.eta.localeCompare(b.eta));
  }, [filteredLines]);

  function handleReserveClick(line: ImpoLineWithAvailability) {
    if (line.qty_available <= 0) {
      setSoldOutLine(line);
    } else {
      setReservingLine(line);
    }
  }

  function nextAvailableForItem(itemCode: string, excludeImpoId: string): ImpoLineWithAvailability | null {
    return lines
      .filter((l) => l.item_code === itemCode && l.impo_id !== excludeImpoId && l.qty_available > 0)
      .sort((a, b) => a.impo.eta.localeCompare(b.impo.eta))[0] ?? null;
  }

  async function cancelReservation(resId: string) {
    if (!confirm("Cancel this reservation?")) return;
    await fetch("/api/stock-reservation/reserve", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reservation_id: resId }),
    });
    load();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Stock Reservation</h1>
        <p className="mt-1 text-sm text-slate-500">Reserve incoming stock from open IMPOs before it arrives.</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search SKU, brand, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <select
          value={filterEta}
          onChange={(e) => setFilterEta(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="all">All ETAs</option>
          {allEtas.map((e) => (
            <option key={e} value={e}>{fmtDate(e)}</option>
          ))}
        </select>
      </div>

      {/* IMPO groups */}
      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          {lines.length === 0 ? "No incoming stock uploaded yet. Grace will upload the shipment sheet." : "No results match your search."}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.impoNumber} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {/* IMPO header */}
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                <svg className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
                <div>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{group.impoNumber}</span>
                  <span className="ml-2 text-xs text-slate-400">ETA: {fmtDate(group.eta)}</span>
                </div>
                <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  {group.lines.length} SKU{group.lines.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* SKU grid */}
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {group.lines.map((line) => {
                  const pct = line.qty_incoming > 0 ? Math.round((line.qty_available / line.qty_incoming) * 100) : 0;
                  const soldOut = line.qty_available <= 0;
                  return (
                    <div
                      key={line.id}
                      className={`flex flex-col rounded-xl border p-3 transition-all ${
                        soldOut
                          ? "border-slate-200 bg-slate-50 opacity-70 dark:border-slate-700 dark:bg-slate-800/50"
                          : "border-indigo-100 bg-white hover:border-indigo-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
                      }`}
                    >
                      {line.brand && (
                        <span className="mb-1 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{line.brand}</span>
                      )}
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{line.item_code}</p>
                      {line.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{line.description}</p>
                      )}

                      {/* Availability bar */}
                      <div className="mt-2 mb-1">
                        <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700">
                          <div
                            className={`h-1.5 rounded-full transition-all ${soldOut ? "bg-red-400" : pct <= 25 ? "bg-amber-400" : "bg-emerald-400"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <p className={`text-xs font-medium ${soldOut ? "text-red-500" : pct <= 25 ? "text-amber-600" : "text-emerald-600"}`}>
                        {soldOut ? "Fully reserved" : `${line.qty_available} of ${line.qty_incoming} available`}
                      </p>

                      <button
                        onClick={() => handleReserveClick(line)}
                        className={`mt-3 w-full rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                          soldOut
                            ? "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                        }`}
                      >
                        {soldOut ? "Check next shipment" : "Reserve"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My Reservations */}
      {myReservations.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">My Reservations</h2>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-left">IMPO</th>
                  <th className="px-4 py-3 text-left">ETA</th>
                  <th className="px-4 py-3 text-left">Qty</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {myReservations.map((r) => {
                  const line = r.impo_line as unknown as ImpoLineWithAvailability | undefined;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{line?.item_code ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{line?.impo?.impo_number ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{fmtDate(line?.impo?.eta ?? null)}</td>
                      <td className="px-4 py-3">
                        {r.qty_approved != null ? (
                          <span><span className="font-bold text-green-600">{r.qty_approved}</span><span className="text-slate-400"> / {r.qty_requested} req</span></span>
                        ) : r.qty_requested}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.customer_ref ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{r.grace_notes ?? r.notes ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "pending" && (
                          <button
                            onClick={() => cancelReservation(r.id)}
                            className="text-xs text-red-500 hover:underline"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {reservingLine && (
        <ReserveModal
          line={reservingLine}
          token={token}
          onClose={() => setReservingLine(null)}
          onSuccess={() => { setReservingLine(null); load(); }}
        />
      )}
      {soldOutLine && (
        <SoldOutPrompt
          itemCode={soldOutLine.item_code}
          currentImpo={soldOutLine.impo.impo_number}
          nextLine={nextAvailableForItem(soldOutLine.item_code, soldOutLine.impo_id)}
          onClose={() => setSoldOutLine(null)}
          onReserveNext={(l) => { setSoldOutLine(null); setReservingLine(l); }}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <RouteGuard requireCapability="stock_reservation">
      <StockReservationPage />
    </RouteGuard>
  );
}
