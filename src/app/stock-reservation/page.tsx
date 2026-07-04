"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import {
  fetchAllLinesWithAvailability,
  fetchMyReservationsWithGroups,
} from "@/lib/stock-reservation";
import type { Impo, ImpoLineWithAvailability, StockReservation } from "@/lib/stock-reservation";

// ── Helpers ───────────────────────────────────────────────────────────────────

type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card";
type ResFilter = "active" | "pending" | "approved" | "fulfilled" | "rejected" | "history";

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
    fulfilled: "bg-cyan-100 text-cyan-700",
    rejected:  "bg-red-100 text-red-700",
    cancelled: "bg-slate-100 text-slate-500",
  };
  return map[status] ?? "bg-slate-100 text-slate-500";
}

// ── Reservation Timeline ──────────────────────────────────────────────────────

interface TimelineStep {
  label: string;
  sublabel?: string;
  state: "done" | "active" | "skipped" | "future";
  color: string;
}

function ReservationTimeline({ reservation }: { reservation: StockReservation }) {
  const line = reservation.impo_line as unknown as ImpoLineWithAvailability | undefined;
  const impo = line?.impo;
  const isRejected  = reservation.status === "rejected" || reservation.status === "cancelled";
  const isApproved  = reservation.status === "approved" || reservation.status === "fulfilled";
  const isFulfilled = reservation.status === "fulfilled";
  const stockArrived = impo?.status === "arrived";

  function fmtShort(d: string | null | undefined): string {
    if (!d) return "";
    return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
      day: "numeric", month: "short",
    });
  }

  const steps: TimelineStep[] = [
    {
      label: "Submitted",
      sublabel: fmtShort(reservation.created_at),
      state: "done",
      color: "#4f46e5",
    },
    {
      label: isRejected ? (reservation.status === "cancelled" ? "Cancelled" : "Rejected") : "Approved",
      sublabel: reservation.reviewed_at ? fmtShort(reservation.reviewed_at) : (isRejected ? "" : "Awaiting"),
      state: isRejected ? "skipped" : isApproved ? "done" : "active",
      color: isRejected ? "#dc2626" : "#059669",
    },
    {
      label: "Stock Arrived",
      sublabel: stockArrived ? "Received" : (impo?.eta ? `ETA ${fmtShort(impo.eta)}` : ""),
      state: isRejected ? "future" : stockArrived ? "done" : isApproved ? "active" : "future",
      color: "#0891b2",
    },
    {
      label: "Collected",
      sublabel: reservation.fulfilled_at ? fmtShort(reservation.fulfilled_at) : "",
      state: isRejected ? "future" : isFulfilled ? "done" : stockArrived && isApproved ? "active" : "future",
      color: "#059669",
    },
  ];

  const lastDoneIdx = steps.reduce((max, s, i) => s.state === "done" ? i : max, -1);

  return (
    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800">
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Reservation Progress</p>
      <div className="relative flex items-start">
        {/* Progress line */}
        <div className="absolute left-4 right-4 top-4 h-0.5 bg-slate-200 dark:bg-slate-700" />
        <div
          className="absolute left-4 top-4 h-0.5 bg-indigo-400 transition-all duration-500"
          style={{ width: lastDoneIdx < 0 ? "0%" : `${(lastDoneIdx / (steps.length - 1)) * (100 - (8 / steps.length))}%` }}
        />

        {steps.map((step, i) => {
          const isDone   = step.state === "done";
          const isActive = step.state === "active";
          const isSkip   = step.state === "skipped";

          let dotBg = "bg-slate-200 dark:bg-slate-700";
          let dotBorder = "border-slate-300 dark:border-slate-600";
          let labelColor = "text-slate-400";

          if (isDone)   { dotBg = ""; dotBorder = ""; labelColor = "text-slate-700 dark:text-slate-200"; }
          if (isActive) { dotBg = "bg-white dark:bg-slate-900"; dotBorder = "border-indigo-500"; labelColor = "text-indigo-700 dark:text-indigo-400"; }
          if (isSkip)   { dotBg = ""; dotBorder = ""; labelColor = "text-red-500"; }

          return (
            <div key={i} className="relative flex flex-1 flex-col items-center gap-1.5">
              {/* Dot */}
              <div
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${dotBg} ${dotBorder} transition-all`}
                style={isDone || isSkip ? { background: step.color, borderColor: step.color } : undefined}
              >
                {isDone && (
                  <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isSkip && (
                  <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {isActive && (
                  <div className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                )}
              </div>
              {/* Label */}
              <p className={`text-center text-[11px] font-semibold leading-tight ${labelColor}`}>{step.label}</p>
              {step.sublabel && (
                <p className="text-center text-[10px] text-slate-400 leading-tight">{step.sublabel}</p>
              )}
            </div>
          );
        })}
      </div>
      {reservation.grace_notes && (
        <p className="mt-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs italic text-slate-500">
          Manager note: {reservation.grace_notes}
        </p>
      )}
    </div>
  );
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
  const [discountOffered, setDiscountOffered] = useState(0);
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
          discount_offered: discountOffered,
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

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Discount Given (%)</span>
          <input
            type="number" min={0} max={100} step="0.5" placeholder="0"
            value={discountOffered || ""}
            onChange={(e) => setDiscountOffered(Math.max(0, Math.min(100, Number(e.target.value))))}
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
  const [expandedResId, setExpandedResId] = useState<string | null>(null);
  const [resFilter, setResFilter] = useState<ResFilter>("active");
  const [historyDays, setHistoryDays] = useState<30 | 90 | 365 | 0>(30);
  const [shipmentIdx, setShipmentIdx] = useState(0);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [l, r] = await Promise.all([
        fetchAllLinesWithAvailability(),
        fetchMyReservationsWithGroups(profile.id),
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
    // Count deposit once per group order; standalone orders counted individually
    const seenGroups = new Set<string>();
    const deposits = myReservations.reduce((s, r) => {
      if (r.group_id) {
        if (seenGroups.has(r.group_id)) return s;
        seenGroups.add(r.group_id);
      }
      return s + (r.amount_paid ?? 0);
    }, 0);
    return { pending, approvedThisMonth, deposits };
  }, [myReservations]);

  // Distributor/vendor names that appear in the brand field but are not product brands
  const EXCLUDED_BRANDS = new Set(["Quad Industrial"]);

  // Upcoming shipments derived from lines — brand-level summary, no qty/SKU details exposed
  const upcomingShipments = useMemo(() => {
    const seen = new Map<string, { impo: Impo; totalAvail: number; brands: Set<string> }>();
    for (const l of lines) {
      const existing = seen.get(l.impo_id);
      if (existing) {
        existing.totalAvail += l.qty_available;
        if (l.brand && !EXCLUDED_BRANDS.has(l.brand.trim())) existing.brands.add(l.brand.trim());
      } else if (l.impo.status !== "cancelled" && l.impo.status !== "arrived" && l.impo.eta) {
        const brands = new Set<string>();
        if (l.brand && !EXCLUDED_BRANDS.has(l.brand.trim())) brands.add(l.brand.trim());
        seen.set(l.impo_id, { impo: l.impo, totalAvail: l.qty_available, brands });
      }
    }
    return Array.from(seen.values())
      .sort((a, b) => (a.impo.eta ?? "").localeCompare(b.impo.eta ?? ""))
      .map(s => ({ impo: s.impo, totalAvail: s.totalAvail, brands: Array.from(s.brands).sort() }));
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

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
    switch (resFilter) {
      case "active":    return myReservations.filter((r) => r.status === "pending" || r.status === "approved");
      case "pending":   return myReservations.filter((r) => r.status === "pending");
      case "approved":  return myReservations.filter((r) => r.status === "approved");
      case "fulfilled": return myReservations.filter((r) => r.status === "fulfilled");
      case "rejected":  return myReservations.filter((r) => r.status === "rejected");
      case "history": {
        if (historyDays === 0) return myReservations;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - historyDays);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        return myReservations.filter((r) => r.created_at.slice(0, 10) >= cutoffStr);
      }
    }
  }, [myReservations, resFilter, historyDays]);

  const resCounts = useMemo(() => ({
    active:    myReservations.filter((r) => r.status === "pending" || r.status === "approved").length,
    pending:   myReservations.filter((r) => r.status === "pending").length,
    approved:  myReservations.filter((r) => r.status === "approved").length,
    fulfilled: myReservations.filter((r) => r.status === "fulfilled").length,
    rejected:  myReservations.filter((r) => r.status === "rejected").length,
    history:   myReservations.length,
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
      <AppShell>
        <div className="flex h-64 items-center justify-center text-slate-400">
          <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Stock Reservation"
        subtitle="Reserve incoming stock from open shipments for your customers."
      />

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`rounded-2xl border p-4 shadow-sm ${stats.pending > 0 ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pending Approval</p>
          <p className={`mt-1 text-2xl font-bold ${stats.pending > 0 ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"}`}>
            {stats.pending}
          </p>
          {stats.pending > 0 && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-500">Awaiting Grace</p>}
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
        <div className={`rounded-2xl border p-4 shadow-sm ${upcomingShipments.length > 0 ? "border-teal-200 bg-teal-50 dark:border-teal-900/40 dark:bg-teal-900/20" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next Shipment</p>
          <p className={`mt-1 text-2xl font-bold ${upcomingShipments.length > 0 ? "text-teal-700 dark:text-teal-400" : "text-slate-400"}`}>
            {upcomingShipments[0] ? fmtDate(upcomingShipments[0].impo.eta) : "—"}
          </p>
          {upcomingShipments[0] && (
            <p className="mt-0.5 text-xs text-teal-600 dark:text-teal-500">{upcomingShipments[0].impo.impo_number}</p>
          )}
        </div>
      </div>

      {/* What's Coming — single card with prev/next navigation, brand-level only */}
      {upcomingShipments.length > 0 && (() => {
        const idx = Math.min(shipmentIdx, upcomingShipments.length - 1);
        const { impo, brands } = upcomingShipments[idx];
        return (
          <div className="mb-6">
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">What&apos;s Coming</h2>
            <div className="flex items-stretch gap-2">
              {/* Prev */}
              <button
                onClick={() => setShipmentIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
                className="flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-30 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                aria-label="Previous shipment"
              >
                <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {/* Card */}
              <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{impo.impo_number}</p>
                    <p className="mt-0.5 text-xl font-bold text-teal-600 dark:text-teal-400">{fmtDate(impo.eta)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      impo.status === "in_transit"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}>
                      {impo.status === "in_transit" ? "In transit" : "Expected"}
                    </span>
                    {upcomingShipments.length > 1 && (
                      <span className="text-xs text-slate-400">{idx + 1} / {upcomingShipments.length}</span>
                    )}
                  </div>
                </div>
                {brands.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {brands.map((b) => (
                      <button
                        key={b}
                        onClick={() => setSearch(b)}
                        className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-teal-100 hover:text-teal-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-teal-900/40 dark:hover:text-teal-300"
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Brands not listed</p>
                )}
              </div>

              {/* Next */}
              <button
                onClick={() => setShipmentIdx((i) => Math.min(upcomingShipments.length - 1, i + 1))}
                disabled={idx === upcomingShipments.length - 1}
                className="flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-30 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                aria-label="Next shipment"
              >
                <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Quick Reserve */}
      <div className="mb-2">
        <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">Quick Reserve</h2>
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by SKU, brand or description…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setExpandedLineId(null); }}
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          {search && (
            <button
              onClick={() => { setSearch(""); setExpandedLineId(null); }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
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
        <div className="mb-8 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-slate-800">
          Search by SKU, brand or description above — or click a brand in &ldquo;What&apos;s Coming&rdquo; to get started
        </div>
      )}

      {/* My Reservations */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">My Reservations</h2>
            <Link
              href="/stock-reservation/new-order"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              New Order
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Date scope — only visible on History tab */}
            {resFilter === "history" && (
              <select
                value={historyDays}
                onChange={(e) => setHistoryDays(Number(e.target.value) as 30 | 90 | 365 | 0)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
              >
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 12 months</option>
                <option value={0}>All time</option>
              </select>
            )}
            <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              {([
                { key: "active",    label: "Active" },
                { key: "pending",   label: "Pending" },
                { key: "approved",  label: "Approved" },
                { key: "fulfilled", label: "Collected" },
                { key: "rejected",  label: "Rejected" },
                { key: "history",   label: "History" },
              ] as { key: ResFilter; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setResFilter(key)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    resFilter === key
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {label}
                  {resCounts[key] > 0 && key !== "history" ? ` (${resCounts[key]})` : ""}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredReservations.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
            {myReservations.length === 0
              ? "No reservations yet. Search above to make your first reservation."
              : resFilter === "active"
              ? "No active reservations — all caught up."
              : resFilter === "history"
              ? "No reservations in this date range."
              : `No ${resFilter} reservations.`}
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
                    <th className="px-4 py-3 text-right">Disc%</th>
                    <th className="px-4 py-3 text-left">Req. By</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredReservations.map((r) => {
                    const line = r.impo_line as unknown as ImpoLineWithAvailability | undefined;
                    const isExpanded = expandedResId === r.id;
                    return (
                      <>
                        <tr
                          key={r.id}
                          onClick={() => setExpandedResId(isExpanded ? null : r.id)}
                          className={`cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 ${isExpanded ? "bg-slate-50 dark:bg-slate-800/30" : ""}`}
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 dark:text-slate-100">{line?.item_code ?? "—"}</p>
                            {r.group_id && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                                Order
                              </span>
                            )}
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
                          <td className="px-4 py-3 text-right">
                            {r.discount_offered && r.discount_offered > 0
                              ? <span className="font-medium text-emerald-700 dark:text-emerald-400">{r.discount_offered}%</span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {r.required_by_date ? fmtDate(r.required_by_date) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(r.status)}`}>
                              {r.status === "fulfilled" ? "collected" : r.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              {r.status === "pending" && (
                                <button
                                  onClick={() => cancelReservation(r.id)}
                                  className="text-xs text-red-500 hover:underline"
                                >
                                  Cancel
                                </button>
                              )}
                              <svg
                                className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                onClick={() => setExpandedResId(isExpanded ? null : r.id)}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${r.id}-timeline`} className="border-b border-slate-100 dark:border-slate-800">
                            <td colSpan={10} className="p-0">
                              <ReservationTimeline reservation={r} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function Page() {
  return (
    <RouteGuard requireCapability="stock_reservation">
      <StockReservationPage />
    </RouteGuard>
  );
}
