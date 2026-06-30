"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { RouteGuard } from "@/components/RouteGuard";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchAllLinesWithAvailability,
  fetchMyReservations,
} from "@/lib/stock-reservation";
import type { Impo, ImpoLineWithAvailability, StockReservation } from "@/lib/stock-reservation";

// ── Helpers ───────────────────────────────────────────────────────────────────

type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card";
type ResFilter = "all" | "pending" | "approved" | "rejected";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
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

// ── Inline reservation form ───────────────────────────────────────────────────

interface InlineReserveFormProps {
  line: ImpoLineWithAvailability;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}

function InlineReserveForm({ line, token, onClose, onSuccess }: InlineReserveFormProps) {
  const [qty, setQty] = useState(Math.min(1, line.qty_available));
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [requiredByDate, setRequiredByDate] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!customerName.trim()) { setError("Customer name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-reservation/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          impo_line_id: line.id,
          qty_requested: qty,
          customer_ref: customerName.trim(),
          customer_phone: customerPhone.trim() || undefined,
          amount_paid: amountPaid ? parseFloat(amountPaid) : 0,
          payment_method: paymentMethod,
          required_by_date: requiredByDate || undefined,
          quote_ref: quoteRef.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
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
    <div className="border-t border-indigo-100 bg-indigo-50/40 px-4 py-4 dark:border-indigo-900/30 dark:bg-indigo-950/20">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
            {line.item_code} · {line.impo.impo_number} · ETA {fmtDate(line.impo.eta)}
          </p>
          <p className="text-xs text-slate-500">{line.qty_available} of {line.qty_incoming} units available</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Quantity *</span>
          <input
            type="number" min={1} max={line.qty_available} value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(line.qty_available, Number(e.target.value))))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Amount Paid (AED)</span>
          <input
            type="number" min={0} step="0.01" placeholder="0.00" value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Payment Method</span>
          <select
            value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Required By</span>
          <input
            type="date" value={requiredByDate}
            onChange={(e) => setRequiredByDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Customer Name *</span>
          <input
            type="text" placeholder="e.g. Al Futtaim Group" value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Customer Phone</span>
          <input
            type="tel" placeholder="+971 50 000 0000" value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Quote / SO Reference</span>
          <input
            type="text" placeholder="e.g. SO-2026-001" value={quoteRef}
            onChange={(e) => setQuoteRef(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Notes for Grace</span>
          <input
            type="text" placeholder="Any context or special instructions…" value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || qty < 1}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </div>
  );
}

// ── Combined SKU type (same item_code merged within one IMPO) ─────────────────

interface CombinedLine {
  key: string;                             // composite key for expandedLineId
  item_code: string;
  brand: string | null;
  description: string | null;
  qty_incoming: number;
  qty_available: number;
  impo: Impo;
  impo_id: string;
  primaryLine: ImpoLineWithAvailability;   // line with most individual availability
}

function combineSameSkus(lines: ImpoLineWithAvailability[]): CombinedLine[] {
  const map = new Map<string, CombinedLine>();
  for (const line of lines) {
    const k = `${line.impo_id}/${line.item_code.toLowerCase()}`;
    const existing = map.get(k);
    if (existing) {
      map.set(k, {
        ...existing,
        qty_incoming:  existing.qty_incoming  + line.qty_incoming,
        qty_available: existing.qty_available + line.qty_available,
        primaryLine:   line.qty_available > existing.primaryLine.qty_available ? line : existing.primaryLine,
      });
    } else {
      map.set(k, {
        key: k,
        item_code:     line.item_code,
        brand:         line.brand,
        description:   line.description,
        qty_incoming:  line.qty_incoming,
        qty_available: line.qty_available,
        impo:          line.impo,
        impo_id:       line.impo_id,
        primaryLine:   line,
      });
    }
  }
  return Array.from(map.values());
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
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [resFilter, setResFilter] = useState<ResFilter>("all");

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

  // Real-time ETA updates from Grace
  useEffect(() => {
    const channel = supabase
      .channel("stock-reservation-impos-eta")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "impos" },
        (payload) => {
          const updated = payload.new as { id: string; eta: string | null };
          setLines((prev) =>
            prev.map((line) =>
              line.impo_id === updated.id ? { ...line, impo: { ...line.impo, eta: updated.eta } } : line
            )
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Stats derived from myReservations (no extra fetch)
  const stats = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const pending = myReservations.filter((r) => r.status === "pending").length;
    const approvedThisMonth = myReservations.filter(
      (r) => r.status === "approved" && r.created_at.startsWith(thisMonth)
    ).length;
    const deposits = myReservations.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
    return { pending, approvedThisMonth, deposits };
  }, [myReservations]);

  // Search results: filter → combine same SKU within same IMPO → return CombinedLine[]
  const searchResults = useMemo((): CombinedLine[] => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    const matching = lines.filter(
      (l) =>
        l.qty_available > 0 &&
        (l.item_code.toLowerCase().includes(q) ||
          (l.brand ?? "").toLowerCase().includes(q) ||
          (l.description ?? "").toLowerCase().includes(q) ||
          l.impo.impo_number.toLowerCase().includes(q))
    );
    return combineSameSkus(matching);
  }, [lines, search]);

  const filteredReservations = useMemo(() => {
    if (resFilter === "all") return myReservations;
    return myReservations.filter((r) => r.status === resFilter);
  }, [myReservations, resFilter]);

  const resCounts = useMemo(() => ({
    all: myReservations.length,
    pending: myReservations.filter((r) => r.status === "pending").length,
    approved: myReservations.filter((r) => r.status === "approved").length,
    rejected: myReservations.filter((r) => r.status === "rejected").length,
  }), [myReservations]);

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
        <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <a
          href="/"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </a>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Stock Reservation</h1>
        <p className="mt-1 text-sm text-slate-500">Reserve incoming stock from open shipments for your customers.</p>
      </div>

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className={`rounded-2xl border p-4 shadow-sm ${stats.pending > 0 ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pending Approval</p>
          <p className={`mt-1 text-2xl font-bold ${stats.pending > 0 ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"}`}>
            {stats.pending}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Approved This Month</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.approvedThisMonth}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Deposits Collected</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {stats.deposits > 0 ? `AED ${stats.deposits.toLocaleString("en-AE", { maximumFractionDigits: 0 })}` : "—"}
          </p>
        </div>
      </div>

      {/* Quick Reserve */}
      <div className="mb-2">
        <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Quick Reserve</h2>
        <input
          type="text"
          placeholder="Search by SKU, brand or description to find available stock…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setExpandedLineId(null); }}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      {/* Search results */}
      {search.trim() ? (
        <div className="mb-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {searchResults.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">
              No available stock matches &ldquo;{search}&rdquo;. Try a different SKU or brand.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {searchResults.map((combined) => (
                <div key={combined.key}>
                  {/* Result row */}
                  <div className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                    <div className="min-w-0 flex-1">
                      {combined.brand && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{combined.brand}</p>
                      )}
                      <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{combined.item_code}</p>
                      {combined.description && (
                        <p className="truncate text-xs text-slate-500">{combined.description}</p>
                      )}
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{combined.impo.impo_number}</p>
                      <p className="text-xs text-slate-400">ETA: {fmtDate(combined.impo.eta)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-emerald-600">{combined.qty_available}</p>
                      <p className="text-xs text-slate-400">of {combined.qty_incoming}</p>
                    </div>
                    <button
                      onClick={() => setExpandedLineId(expandedLineId === combined.key ? null : combined.key)}
                      className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                        expandedLineId === combined.key
                          ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                      }`}
                    >
                      {expandedLineId === combined.key ? "Close" : "Reserve"}
                    </button>
                  </div>

                  {/* Inline form — uses primaryLine (most availability within the combined group) */}
                  {expandedLineId === combined.key && (
                    <InlineReserveForm
                      line={combined.primaryLine}
                      token={token}
                      onClose={() => setExpandedLineId(null)}
                      onSuccess={() => { setExpandedLineId(null); setSearch(""); load(); }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-8 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400 dark:border-slate-800">
          Enter a SKU, brand or description above to find available stock
        </div>
      )}

      {/* My Reservations */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">My Reservations</h2>
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {(["all", "pending", "approved", "rejected"] as ResFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setResFilter(f)}
                className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  resFilter === f
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                {resCounts[f] > 0 ? ` (${resCounts[f]})` : ""}
              </button>
            ))}
          </div>
        </div>

        {filteredReservations.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
            {myReservations.length === 0
              ? "No reservations yet. Search above to make your first reservation."
              : `No ${resFilter === "all" ? "" : resFilter + " "}reservations.`}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-left">IMPO · ETA</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-left">Req. By</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredReservations.map((r) => {
                    const line = r.impo_line as unknown as ImpoLineWithAvailability | undefined;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900 dark:text-slate-100">{line?.item_code ?? "—"}</p>
                          {r.quote_ref && <p className="text-xs text-slate-400">{r.quote_ref}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-slate-600 dark:text-slate-400">{line?.impo?.impo_number ?? "—"}</p>
                          <p className="text-xs text-slate-400">{fmtDate(line?.impo?.eta ?? null)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-slate-700 dark:text-slate-300">{r.customer_ref ?? "—"}</p>
                          {r.customer_phone && <p className="text-xs text-slate-400">{r.customer_phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.qty_approved != null ? (
                            <span>
                              <span className="font-bold text-green-600">{r.qty_approved}</span>
                              <span className="text-xs text-slate-400"> / {r.qty_requested}</span>
                            </span>
                          ) : (
                            r.qty_requested
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                          {r.amount_paid ? `AED ${r.amount_paid.toLocaleString("en-AE", { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-500">
                          {r.payment_method?.replace("_", " ") ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {r.required_by_date ? fmtDate(r.required_by_date) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(r.status)}`}>
                            {r.status}
                          </span>
                          {r.grace_notes && (
                            <p className="mt-0.5 text-xs italic text-slate-400">{r.grace_notes}</p>
                          )}
                        </td>
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
      </div>
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
