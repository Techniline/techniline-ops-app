"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { supabase } from "@/lib/supabaseClient";
import { fetchAllLinesWithAvailability } from "@/lib/stock-reservation";
import type { ImpoLineWithAvailability } from "@/lib/stock-reservation";

type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

interface CartItem {
  lineId: string;
  itemCode: string;
  brand: string | null;
  description: string | null;
  impoNumber: string;
  impoEta: string | null;
  qtyAvailable: number;
  qtyRequested: number;
  discountOffered: number;
}

function NewOrderPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? "");
    });
  }, []);

  const [lines, setLines] = useState<ImpoLineWithAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  // Customer / order details
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [requiredByDate, setRequiredByDate] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!profile) return;
    fetchAllLinesWithAvailability()
      .then(setLines)
      .finally(() => setLoading(false));
  }, [profile]);

  const searchResults = useMemo((): ImpoLineWithAvailability[] => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    const cartIds = new Set(cart.map((c) => c.lineId));
    return lines.filter(
      (l) =>
        l.qty_available > 0 &&
        !cartIds.has(l.id) &&
        (l.item_code.toLowerCase().includes(q) ||
          (l.brand ?? "").toLowerCase().includes(q) ||
          (l.description ?? "").toLowerCase().includes(q) ||
          l.impo.impo_number.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [lines, search, cart]);

  function addToCart(line: ImpoLineWithAvailability) {
    setCart((prev) => {
      if (prev.some((c) => c.lineId === line.id)) return prev;
      return [...prev, {
        lineId: line.id,
        itemCode: line.item_code,
        brand: line.brand,
        description: line.description,
        impoNumber: line.impo.impo_number,
        impoEta: line.impo.eta,
        qtyAvailable: line.qty_available,
        qtyRequested: Math.min(1, line.qty_available),
        discountOffered: 0,
      }];
    });
    setSearch("");
  }

  function removeFromCart(lineId: string) {
    setCart((prev) => prev.filter((c) => c.lineId !== lineId));
    setLineErrors((prev) => { const m = new Map(prev); m.delete(lineId); return m; });
  }

  function updateQty(lineId: string, qty: number) {
    setCart((prev) =>
      prev.map((c) => c.lineId === lineId
        ? { ...c, qtyRequested: Math.max(1, Math.min(c.qtyAvailable, qty)) }
        : c
      )
    );
  }

  const canSubmit = cart.length > 0 && customerName.trim().length > 0;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setLineErrors(new Map());

    try {
      const res = await fetch("/api/stock-reservation/group", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customer_ref: customerName.trim(),
          customer_phone: customerPhone.trim() || undefined,
          amount_paid: amountPaid ? parseFloat(amountPaid) : 0,
          payment_method: paymentMethod,
          required_by_date: requiredByDate || undefined,
          quote_ref: quoteRef.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: cart.map((c) => ({ impo_line_id: c.lineId, qty_requested: c.qtyRequested, discount_offered: c.discountOffered })),
        }),
      });

      const data = await res.json() as { ok: boolean; error?: string; partial?: boolean; failed?: { index: number; error: string }[]; details?: { index: number; error: string }[]; group_id?: string };

      if (!data.ok) {
        // Check for line-level errors
        if (data.details) {
          const m = new Map<string, string>();
          for (const f of (data.details as { index: number; error: string }[])) {
            const lineId = cart[f.index]?.lineId;
            if (lineId) m.set(lineId, f.error);
          }
          setLineErrors(m);
        }
        setError(data.error ?? "Submission failed.");
        return;
      }

      if (data.partial && data.failed?.length) {
        const m = new Map<string, string>();
        for (const f of data.failed) {
          const lineId = cart[f.index]?.lineId;
          if (lineId) m.set(lineId, f.error);
        }
        setLineErrors(m);
        setError(`${data.failed.length} line(s) could not be reserved — see highlighted items. The rest were submitted.`);
        // Remove successful items from cart
        const failedIds = new Set(data.failed.map((f) => cart[f.index]?.lineId).filter(Boolean));
        setCart((prev) => prev.filter((c) => failedIds.has(c.lineId)));
        return;
      }

      // Full success — go back to stock reservation page
      router.push("/stock-reservation");
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
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
        title="New Order Request"
        subtitle="Reserve multiple SKUs for one customer in a single order."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">

        {/* Left: Customer + Items */}
        <div className="space-y-6">

          {/* Customer details card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">Customer &amp; Order Details</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">Customer Name <span className="text-red-400">*</span></span>
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
                <span className="text-xs font-medium text-slate-500">Required By Date</span>
                <input
                  type="date" value={requiredByDate}
                  onChange={(e) => setRequiredByDate(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
              <label className="col-span-full flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <span className="text-xs font-medium text-slate-500">Notes for Grace</span>
                <input
                  type="text" placeholder="Any context or special instructions…" value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
            </div>
          </div>

          {/* SKU search */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">Add SKUs</h2>
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by SKU, brand or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {search.trim() && (
              <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                {searchResults.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-400">No available stock matches &ldquo;{search}&rdquo;</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {searchResults.map((line) => (
                      <div key={line.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <div className="min-w-0 flex-1">
                          {line.brand && <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{line.brand}</p>}
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{line.item_code}</p>
                          {line.description && <p className="truncate text-xs text-slate-500">{line.description}</p>}
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{line.impo.impo_number}</p>
                          <p className="text-xs text-slate-400">ETA: {fmtDate(line.impo.eta)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-emerald-600">{line.qty_available}</p>
                          <p className="text-[10px] text-slate-400">avail.</p>
                        </div>
                        <button
                          onClick={() => addToCart(line)}
                          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!search.trim() && cart.length === 0 && (
              <p className="mt-3 text-sm text-slate-400">Search for a SKU or brand above to add items to this order.</p>
            )}
          </div>
        </div>

        {/* Right: Cart + Submit */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-indigo-200 bg-white shadow-sm dark:border-indigo-900/40 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-indigo-100 px-5 py-4 dark:border-indigo-900/30">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100">Order Basket</h2>
                <p className="text-xs text-slate-400">{cart.length} item{cart.length !== 1 ? "s" : ""} · {cart.reduce((s, c) => s + c.qtyRequested, 0)} units total</p>
              </div>
              {cart.length > 0 && (
                <button onClick={() => setCart([])} className="text-xs text-red-400 hover:text-red-600">Clear all</button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Your basket is empty. Search above to add items.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {cart.map((item) => {
                  const hasError = lineErrors.has(item.lineId);
                  return (
                    <div key={item.lineId} className={`px-4 py-3 ${hasError ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {item.brand && <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.brand}</p>}
                          <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{item.itemCode}</p>
                          <p className="text-xs text-slate-400">{item.impoNumber} · ETA {fmtDate(item.impoEta)}</p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.lineId)}
                          className="shrink-0 rounded p-0.5 text-slate-300 hover:text-red-500"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
                          <button
                            onClick={() => updateQty(item.lineId, item.qtyRequested - 1)}
                            disabled={item.qtyRequested <= 1}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30"
                          >
                            −
                          </button>
                          <input
                            type="number" min={1} max={item.qtyAvailable}
                            value={item.qtyRequested}
                            onChange={(e) => updateQty(item.lineId, Number(e.target.value))}
                            className="w-10 bg-transparent text-center text-sm font-semibold text-slate-900 focus:outline-none dark:text-slate-100"
                          />
                          <button
                            onClick={() => updateQty(item.lineId, item.qtyRequested + 1)}
                            disabled={item.qtyRequested >= item.qtyAvailable}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-xs text-slate-400">of {item.qtyAvailable} avail.</span>
                        <div className="flex items-center gap-1.5">
                          <label className="text-[10px] text-slate-400 whitespace-nowrap">Disc%</label>
                          <input
                            type="number" min={0} max={100} step="0.5"
                            value={item.discountOffered || ""}
                            placeholder="0"
                            onChange={(e) => setCart((prev) =>
                              prev.map((c) => c.lineId === item.lineId
                                ? { ...c, discountOffered: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }
                                : c
                              )
                            )}
                            className="w-16 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center text-xs dark:border-slate-700 dark:bg-slate-800"
                          />
                        </div>
                      </div>
                      {hasError && (
                        <p className="mt-1.5 text-xs text-red-600">{lineErrors.get(item.lineId)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Order summary */}
          {cart.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{customerName.trim() || <span className="italic text-slate-400">not set</span>}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Lines</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{cart.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Units</span>
                  <span className="font-bold text-indigo-600">{cart.reduce((s, c) => s + c.qtyRequested, 0)}</span>
                </div>
                {amountPaid && parseFloat(amountPaid) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment</span>
                    <span className="font-medium text-emerald-700">AED {parseFloat(amountPaid).toLocaleString("en")}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? "Submitting order…"
              : cart.length === 0
              ? "Add items to continue"
              : !customerName.trim()
              ? "Enter customer name to continue"
              : `Submit Order · ${cart.length} line${cart.length !== 1 ? "s" : ""}`}
          </button>

          <button
            onClick={() => router.back()}
            className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </AppShell>
  );
}

export default function Page() {
  return (
    <RouteGuard requireCapability="stock_reservation">
      <NewOrderPage />
    </RouteGuard>
  );
}
