"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, btnSmall, surface } from "@/components/ui";
import { workingMinutesBetween, nextWorkingMoment, fmtWorkingMin } from "@/lib/workingHours";
import type { ConsultBooking, BookingStatus } from "@/lib/consults/types";
import { STATUS_LABELS } from "@/lib/consults/types";

// ── Urgency ────────────────────────────────────────────────────────────────

type Urgency = "green" | "amber" | "red";

function getUrgency(booking: ConsultBooking, now: Date): Urgency {
  if (booking.status === "closed" || booking.status === "called") return "green";
  const deadline = new Date(booking.sla_deadline);
  if (now >= deadline) return "red";
  const remaining = workingMinutesBetween(now, deadline);
  return remaining <= 120 ? "amber" : "green";
}

function workingMinsRemaining(booking: ConsultBooking, now: Date): number {
  const deadline = new Date(booking.sla_deadline);
  if (now >= deadline) return 0;
  return workingMinutesBetween(now, deadline);
}

function workingMinsWaiting(booking: ConsultBooking, now: Date): number {
  const effective = nextWorkingMoment(new Date(booking.created_at));
  if (effective >= now) return 0;
  return workingMinutesBetween(effective, now);
}

// ── Status badge ──────────────────────────────────────────────────────────

const STATUS_CHIP: Record<BookingStatus, string> = {
  pending:
    "bg-amber-50 text-amber-700 border border-amber-200",
  called:
    "bg-green-50 text-green-700 border border-green-200",
  no_answer:
    "bg-slate-100 text-slate-600 border border-slate-200",
  closed:
    "bg-slate-50 text-slate-500 border border-slate-200",
};

const URGENCY_STRIPE: Record<Urgency, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
};

// ── Detail drawer ──────────────────────────────────────────────────────────

interface DrawerProps {
  booking: ConsultBooking;
  now: Date;
  token: string;
  onClose: () => void;
  onUpdated: (b: ConsultBooking) => void;
}

function BookingDrawer({ booking, now, token, onClose, onUpdated }: DrawerProps) {
  const [status, setStatus] = useState<BookingStatus>(booking.status);
  const [callNotes, setCallNotes] = useState(booking.call_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const urgency = getUrgency(booking, now);
  const minsWaiting = workingMinsWaiting(booking, now);
  const minsRemaining = workingMinsRemaining(booking, now);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/consults/${booking.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status, call_notes: callNotes || null }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Save failed");
      onUpdated({ ...booking, status, call_notes: callNotes || null, updated_at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-colors";

  const deadlineStr = new Date(booking.sla_deadline).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${URGENCY_STRIPE[urgency]}`} />
            <h2 className="text-base font-semibold text-slate-900">{booking.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Contact info */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <ContactRow label="Phone">
              <a href={`tel:${booking.phone}`} className="font-medium text-indigo-600 hover:underline">
                {booking.phone}
              </a>
            </ContactRow>
            {booking.email && (
              <ContactRow label="Email">
                <a href={`mailto:${booking.email}`} className="text-indigo-600 hover:underline">
                  {booking.email}
                </a>
              </ContactRow>
            )}
            {booking.preferred_slot && (
              <ContactRow label="Preferred time">
                <span className="capitalize">{booking.preferred_slot.replace(/_/g, " ")}</span>
              </ContactRow>
            )}
            {booking.notes && (
              <ContactRow label="Notes">
                <span className="text-slate-700">{booking.notes}</span>
              </ContactRow>
            )}
          </div>

          {/* SLA chips */}
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className={`rounded-full px-2.5 py-1 ${urgency === "red" ? "bg-red-100 text-red-700" : urgency === "amber" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
              {urgency === "red" ? "SLA overdue" : `${fmtWorkingMin(minsRemaining)} left`}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">
              Waiting {fmtWorkingMin(minsWaiting)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">
              Deadline {deadlineStr}
            </span>
          </div>

          {/* Status update */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(STATUS_LABELS) as BookingStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    status === s
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Call notes */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Call notes
            </label>
            <textarea
              rows={4}
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder="What was discussed, follow-up needed, etc."
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Received at */}
          <p className="text-xs text-slate-400">
            Received{" "}
            {new Date(booking.created_at).toLocaleString("en-GB", {
              day: "numeric", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </p>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className={`${btnSecondary} ${btnSmall}`}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={`${btnPrimary} ${btnSmall}`}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </aside>
    </>
  );
}

function ContactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

// ── Booking row ───────────────────────────────────────────────────────────

function BookingRow({
  booking,
  now,
  onSelect,
}: {
  booking: ConsultBooking;
  now: Date;
  onSelect: () => void;
}) {
  const urgency = getUrgency(booking, now);
  const minsRemaining = workingMinsRemaining(booking, now);
  const minsWaiting = workingMinsWaiting(booking, now);

  return (
    <tr
      className="group cursor-pointer border-b border-slate-100 hover:bg-slate-50 transition-colors"
      onClick={onSelect}
    >
      {/* Urgency stripe */}
      <td className="pl-0 pr-0 w-1">
        <div className={`h-full w-1 rounded-r-full ${URGENCY_STRIPE[urgency]}`} />
      </td>
      <td className="py-3 pl-3 pr-4">
        <p className="font-medium text-slate-900 text-sm">{booking.name}</p>
        <p className="text-xs text-slate-500">{booking.phone}</p>
      </td>
      <td className="py-3 px-4 text-sm text-slate-700 hidden sm:table-cell">
        {booking.notes ? (
          <span className="line-clamp-1 text-xs text-slate-500">{booking.notes}</span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-4 hidden md:table-cell">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[booking.status]}`}
        >
          {STATUS_LABELS[booking.status]}
        </span>
      </td>
      <td className="py-3 px-4 text-xs hidden lg:table-cell">
        {booking.status === "closed" || booking.status === "called" ? (
          <span className="text-slate-400">—</span>
        ) : urgency === "red" ? (
          <span className="font-medium text-red-600">Overdue</span>
        ) : (
          <span className={urgency === "amber" ? "font-medium text-amber-600" : "text-slate-500"}>
            {fmtWorkingMin(minsRemaining)} left
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-xs text-slate-400 hidden xl:table-cell">
        {fmtWorkingMin(minsWaiting)} waiting
      </td>
      <td className="py-3 pl-4 pr-3 text-xs text-slate-400 whitespace-nowrap">
        {new Date(booking.created_at).toLocaleString("en-GB", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        })}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

type StatusTab = "pending" | "no_answer" | "called" | "closed" | "all";

const TABS: { value: StatusTab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "no_answer", label: "No answer" },
  { value: "called", label: "Called" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

function ConsultsPage() {
  useAuth(); // ensure auth context is active
  const [token, setToken] = useState("");
  const [bookings, setBookings] = useState<ConsultBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<StatusTab>("pending");
  const [selected, setSelected] = useState<ConsultBooking | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? "");
    });
  }, []);

  // Refresh "now" every 30s so urgency stays live
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const tok = session?.access_token ?? "";
    if (!tok) return;
    setToken(tok);
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/consults?status=${tab}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Load failed");
      setBookings(json.bookings as ConsultBooking[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  // Sort: overdue first, then by sla_deadline ascending (most urgent)
  const sorted = [...bookings].sort((a, b) => {
    const aDeadline = new Date(a.sla_deadline).getTime();
    const bDeadline = new Date(b.sla_deadline).getTime();
    const aOverdue = now.getTime() >= aDeadline;
    const bOverdue = now.getTime() >= bDeadline;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return aDeadline - bDeadline;
  });

  const counts = {
    pending: bookings.filter((b) => b.status === "pending").length,
    no_answer: bookings.filter((b) => b.status === "no_answer").length,
    red: bookings.filter((b) => getUrgency(b, now) === "red" && b.status === "pending").length,
  };

  return (
    <AppShell>
      <RouteGuard requireCapability="consults">
        <div className="flex flex-col h-full min-h-0">
          <PageHeader
            title="Consult Bookings"
            subtitle={
              counts.red > 0
                ? `${counts.red} overdue · ${counts.pending} pending`
                : counts.pending > 0
                ? `${counts.pending} pending`
                : "All clear"
            }
            actions={
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className={`${btnSecondary} ${btnSmall}`}
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
            }
          />

          {/* Tabs */}
          <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
            <nav className="-mb-px flex gap-0">
              {TABS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
                  className={`border-b-2 px-3 py-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    tab === t.value
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-24 text-sm text-slate-400">
                Loading…
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-sm font-medium text-slate-500">No bookings in this view</p>
                <p className="mt-1 text-xs text-slate-400">Bookings from the public form appear here</p>
              </div>
            ) : (
              <div className={`${surface} overflow-hidden`}>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="w-1 p-0" />
                      <th className="py-2.5 pl-3 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Customer
                      </th>
                      <th className="hidden sm:table-cell py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Notes
                      </th>
                      <th className="hidden md:table-cell py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                      <th className="hidden lg:table-cell py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        SLA
                      </th>
                      <th className="hidden xl:table-cell py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Wait
                      </th>
                      <th className="py-2.5 pl-4 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Received
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((b) => (
                      <BookingRow
                        key={b.id}
                        booking={b}
                        now={now}
                        onSelect={() => setSelected(b)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {selected && token && (
          <BookingDrawer
            booking={selected}
            now={now}
            token={token}
            onClose={() => setSelected(null)}
            onUpdated={(updated) => {
              setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
              setSelected(null);
            }}
          />
        )}
      </RouteGuard>
    </AppShell>
  );
}

export default ConsultsPage;
