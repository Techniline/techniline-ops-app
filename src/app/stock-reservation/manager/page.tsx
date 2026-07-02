"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchImpos,
  fetchAllReservations,
  fetchPendingReservations,
  fetchPendingGrouped,
  fetchManagerStats,
} from "@/lib/stock-reservation";
import type { Impo, StockReservation, UploadPreviewLine, UploadConfirmPayload, ReservationGroup } from "@/lib/stock-reservation";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending:    "bg-amber-100 text-amber-700",
    in_transit: "bg-blue-100 text-blue-700",
    arrived:    "bg-green-100 text-green-700",
    cancelled:  "bg-slate-100 text-slate-500",
    approved:   "bg-green-100 text-green-700",
    rejected:   "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-slate-100 text-slate-500";
}

// ── Upload Flow ───────────────────────────────────────────────────────────────

interface UploadPanelProps { token: string; onDone: () => void; }
interface ParsedPreview {
  impo_number: string; vendor: string | null; po_date: string | null;
  lines: UploadPreviewLine[]; file_name: string;
}

function UploadPanel({ onDone }: Omit<UploadPanelProps, "token">) {
  const [step, setStep] = useState<"select" | "preview" | "saving">("select");
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [editedImpo, setEditedImpo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function freshToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function handleFile(file: File) {
    setUploading(true); setError(null);
    try {
      const tok = await freshToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/stock-reservation/upload?action=preview", {
        method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: form,
      });
      const data = await res.json() as ParsedPreview & { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Upload failed."); return; }
      setPreview(data); setEditedImpo(data.impo_number ?? ""); setStep("preview");
    } catch { setError("Network error during upload."); }
    finally { setUploading(false); }
  }

  async function confirm() {
    if (!preview) return;
    setStep("saving"); setError(null);
    const payload: UploadConfirmPayload = { impo_number: editedImpo.trim(), lines: preview.lines, source_file_name: preview.file_name };
    try {
      const tok = await freshToken();
      const res = await fetch("/api/stock-reservation/upload?action=confirm", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Confirm failed."); setStep("preview"); return; }
      onDone();
    } catch { setError("Network error during save."); setStep("preview"); }
  }

  function reset() { setStep("select"); setPreview(null); setEditedImpo(""); setError(null); }

  if (step === "select") {
    return (
      <div
        className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition-colors hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-900"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input ref={inputRef} type="file" accept=".pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <svg className="h-6 w-6 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-slate-500">Parsing PDF…</p>
          </div>
        ) : (
          <>
            <svg className="mx-auto mb-3 h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Drop Purchase Order PDF here or click to browse</p>
            <p className="mt-1 text-xs text-slate-400">One PDF per IMPO · IMPO number is read from the document automatically</p>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Review & Confirm</h3>
          <p className="text-sm text-slate-400">
            {preview?.file_name}{preview?.vendor && <> · {preview.vendor}</>}
            {preview?.po_date && <> · PO date: {preview.po_date}</>}
            {" · "}{preview?.lines.length ?? 0} SKUs
          </p>
        </div>
        <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-700">Back</button>
      </div>
      <div className="mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">IMPO Number <span className="text-slate-400">(extracted — edit if needed)</span></span>
          <input type="text" value={editedImpo} onChange={(e) => setEditedImpo(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </label>
        <p className="mt-1.5 inline-block rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ETA is not in the PO — set it after saving from the IMPO list.
        </p>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-400 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Model No</th>
              <th className="px-3 py-2 text-left">Brand</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {(preview?.lines ?? []).map((l, i) => (
              <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                <td className="px-3 py-1.5 font-medium text-slate-800 dark:text-slate-200">{l.item_code}</td>
                <td className="px-3 py-1.5 text-slate-500">{l.brand ?? "—"}</td>
                <td className="max-w-xs truncate px-3 py-1.5 text-slate-500">{l.description ?? "—"}</td>
                <td className="px-3 py-1.5 text-right font-medium text-slate-700 dark:text-slate-300">{l.qty_incoming}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={reset} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
        <button onClick={confirm} disabled={step === "saving" || !editedImpo.trim() || !preview?.lines.length}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {step === "saving" ? "Saving…" : `Save ${preview?.lines.length ?? 0} SKUs`}
        </button>
      </div>
    </div>
  );
}

// ── Approval Card ─────────────────────────────────────────────────────────────

interface ApprovalCardProps { reservation: StockReservation; getToken: () => Promise<string>; onDone: () => void; }

function ApprovalCard({ reservation: res, getToken, onDone }: ApprovalCardProps) {
  const [qty, setQty] = useState(res.qty_requested);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const line = res.impo_line as unknown as { item_code?: string; description?: string; qty_incoming?: number; impo?: { impo_number?: string; eta?: string } } | undefined;

  async function act(action: "approve" | "reject") {
    setSaving(true); setError(null);
    try {
      const tok = await getToken();
      const r = await fetch("/api/stock-reservation/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ reservation_id: res.id, action, qty_approved: action === "approve" ? qty : undefined, grace_notes: notes.trim() || undefined }),
      });
      const data = await r.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Failed."); return; }
      onDone();
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {res.requester_name ?? "User"} · {line?.item_code ?? "—"}
          </p>
          <p className="text-sm text-slate-500">
            {line?.impo?.impo_number ?? "—"} · ETA {line?.impo?.eta ? fmtDate(line.impo.eta) : "—"}
            {res.customer_ref && <> · <span className="font-medium text-indigo-600">{res.customer_ref}</span></>}
            {res.customer_phone && <> · {res.customer_phone}</>}
          </p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
            {res.amount_paid != null && res.amount_paid > 0 && (
              <span className="font-medium text-emerald-700">
                AED {res.amount_paid.toLocaleString("en-AE", { maximumFractionDigits: 0 })} paid ({res.payment_method?.replace("_", " ")})
              </span>
            )}
            {res.required_by_date && <span>Required by: {fmtDate(res.required_by_date)}</span>}
            {res.quote_ref && <span>Ref: {res.quote_ref}</span>}
            {(res.discount_offered ?? 0) > 0 && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                {res.discount_offered}% discount given
              </span>
            )}
          </div>
          {res.notes && <p className="mt-1 text-xs italic text-slate-400">{res.notes}</p>}
        </div>
        <span className="shrink-0 text-sm font-bold text-slate-700 dark:text-slate-300">
          {res.qty_requested} unit{res.qty_requested !== 1 ? "s" : ""} requested
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Approve qty</span>
          <input type="number" min={1} max={res.qty_requested} value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
            className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Note (optional)</span>
          <input type="text" placeholder="Reason or note to requester…" value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <div className="flex gap-2 self-end">
          <button onClick={() => act("reject")} disabled={saving}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Reject</button>
          <button onClick={() => act("approve")} disabled={saving || qty < 1}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
            {saving ? "Saving…" : "Approve"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ── Group Approval Card ────────────────────────────────────────────────────────

interface GroupApprovalCardProps {
  groupId: string;
  group: ReservationGroup;
  reservations: StockReservation[];
  getToken: () => Promise<string>;
  onDone: () => void;
}

function GroupApprovalCard({ groupId, group, reservations, getToken, onDone }: GroupApprovalCardProps) {
  const [decisions, setDecisions] = useState<Map<string, { action: "approve" | "reject"; qty: number }>>(
    () => new Map(reservations.map((r) => [r.id, { action: "approve" as const, qty: r.qty_requested }]))
  );
  const [graceNote, setGraceNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requesterName = reservations[0]?.requester_name ?? "User";

  function setLineAction(id: string, action: "approve" | "reject") {
    setDecisions((prev) => { const m = new Map(prev); m.set(id, { ...m.get(id)!, action }); return m; });
  }

  function setLineQty(id: string, qty: number) {
    setDecisions((prev) => { const m = new Map(prev); m.set(id, { ...m.get(id)!, qty }); return m; });
  }

  function approveAll() {
    setDecisions(new Map(reservations.map((r) => [r.id, { action: "approve" as const, qty: r.qty_requested }])));
  }

  function rejectAll() {
    setDecisions(new Map(reservations.map((r) => [r.id, { action: "reject" as const, qty: r.qty_requested }])));
  }

  async function submit() {
    setSaving(true); setError(null);
    try {
      const decisionsList = Array.from(decisions.entries()).map(([id, d]) => ({
        reservation_id: id,
        action: d.action,
        ...(d.action === "approve" ? { qty_approved: d.qty } : {}),
      }));
      const tok = await getToken();
      const r = await fetch("/api/stock-reservation/group-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ group_id: groupId, decisions: decisionsList, grace_notes: graceNote.trim() || undefined }),
      });
      const data = await r.json() as { ok: boolean; error?: string; warnings?: string[] };
      if (!data.ok) { setError(data.error ?? "Failed."); return; }
      onDone();
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  const approvedCount = Array.from(decisions.values()).filter((d) => d.action === "approve").length;
  const totalUnits = reservations.reduce((s, r) => s + r.qty_requested, 0);

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-indigo-200 bg-white shadow-sm dark:border-indigo-800/60 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-indigo-100 bg-indigo-50/60 px-5 py-4 dark:border-indigo-900/40 dark:bg-indigo-950/20">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Multi-SKU Order · {reservations.length} lines
            </span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{requesterName}</p>
          </div>
          <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-400">
            <span className="font-semibold">{group.customer_ref}</span>
            {group.customer_phone && <> · {group.customer_phone}</>}
          </p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
            {group.amount_paid != null && group.amount_paid > 0 && (
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                AED {group.amount_paid.toLocaleString("en-AE", { maximumFractionDigits: 0 })} paid ({group.payment_method?.replace("_", " ")})
              </span>
            )}
            {group.required_by_date && <span>Required by: {fmtDate(group.required_by_date)}</span>}
            {group.quote_ref && <span>Ref: {group.quote_ref}</span>}
          </div>
          {group.notes && <p className="mt-1 text-xs italic text-slate-400">{group.notes}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-indigo-700 dark:text-indigo-400">{totalUnits} units total</p>
          <p className="text-xs text-slate-400">{reservations.length} SKU{reservations.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Line items table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
            <tr>
              <th className="px-4 py-2.5 text-left">SKU / Item</th>
              <th className="px-4 py-2.5 text-left">IMPO · ETA</th>
              <th className="px-4 py-2.5 text-right">Qty Req</th>
              <th className="px-4 py-2.5 text-right">Disc%</th>
              <th className="px-4 py-2.5 text-center">Approve Qty</th>
              <th className="px-4 py-2.5 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {reservations.map((r) => {
              const line = r.impo_line as unknown as { item_code?: string; brand?: string | null; description?: string | null; impo?: { impo_number?: string; eta?: string | null } } | undefined;
              const d = decisions.get(r.id) ?? { action: "approve" as const, qty: r.qty_requested };
              const isApprove = d.action === "approve";
              return (
                <tr key={r.id} className={`${isApprove ? "" : "opacity-60"} hover:bg-slate-50 dark:hover:bg-slate-800/20`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{line?.item_code ?? "—"}</p>
                    {line?.brand && <p className="text-xs text-slate-400">{line.brand}</p>}
                    {line?.description && <p className="max-w-[200px] truncate text-xs text-slate-400">{line.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-600 dark:text-slate-400">{line?.impo?.impo_number ?? "—"}</p>
                    <p className="text-xs text-slate-400">{fmtDate(line?.impo?.eta ?? null)}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-300">{r.qty_requested}</td>
                  <td className="px-4 py-3 text-right">
                    {(r.discount_offered ?? 0) > 0
                      ? <span className="font-semibold text-emerald-700 dark:text-emerald-400">{r.discount_offered}%</span>
                      : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isApprove ? (
                      <input
                        type="number" min={1} max={r.qty_requested} value={d.qty}
                        onChange={(e) => setLineQty(r.id, Math.max(1, Math.min(r.qty_requested, Number(e.target.value))))}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-center text-sm dark:border-slate-700 dark:bg-slate-800"
                      />
                    ) : (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700">
                      <button
                        onClick={() => setLineAction(r.id, "approve")}
                        className={`rounded-l-lg px-3 py-1 text-xs font-semibold transition-colors ${
                          isApprove
                            ? "bg-green-600 text-white"
                            : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setLineAction(r.id, "reject")}
                        className={`rounded-r-lg border-l border-slate-200 px-3 py-1 text-xs font-semibold transition-colors dark:border-slate-700 ${
                          !isApprove
                            ? "bg-red-600 text-white"
                            : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        ✗
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">
            <button
              onClick={approveAll}
              className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-400"
            >
              ✓ Approve All
            </button>
            <button
              onClick={rejectAll}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400"
            >
              ✗ Reject All
            </button>
          </div>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Note for salesperson (optional)</span>
            <input
              type="text" placeholder="Reason or notes for all lines…" value={graceNote}
              onChange={(e) => setGraceNote(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <button
            onClick={submit}
            disabled={saving}
            className="self-end rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : `Submit (${approvedCount} approve · ${reservations.length - approvedCount} reject)`}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}

// ── Report Tab ────────────────────────────────────────────────────────────────

interface ReportTabProps { reservations: StockReservation[]; impos: Impo[]; }

function ReportTab({ reservations, impos }: ReportTabProps) {
  const [filterImpo, setFilterImpo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSalesperson, setFilterSalesperson] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showEmailPanel, setShowEmailPanel] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");

  // Unique salespersons from reservations
  const salespersons = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of reservations) {
      if (r.requested_by && !seen.has(r.requested_by)) {
        seen.set(r.requested_by, r.requester_name ?? r.requested_by);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [reservations]);

  const filtered = useMemo(() => {
    return reservations.filter((r) => {
      const line = r.impo_line as unknown as { brand?: string | null; impo?: { id?: string } } | undefined;
      if (filterImpo && line?.impo?.id !== filterImpo) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterSalesperson && r.requested_by !== filterSalesperson) return false;
      if (filterBrand && !(line?.brand ?? "").toLowerCase().includes(filterBrand.toLowerCase())) return false;
      if (filterDateFrom && r.created_at.slice(0, 10) < filterDateFrom) return false;
      if (filterDateTo && r.created_at.slice(0, 10) > filterDateTo) return false;
      return true;
    });
  }, [reservations, filterImpo, filterStatus, filterSalesperson, filterBrand, filterDateFrom, filterDateTo]);

  // Group by IMPO
  const grouped = useMemo(() => {
    const map = new Map<string, { impoId: string; impoNumber: string; eta: string | null; status: string; rows: StockReservation[] }>();
    for (const r of filtered) {
      const line = r.impo_line as unknown as { impo?: { id?: string; impo_number?: string; eta?: string | null; status?: string } } | undefined;
      const impoId  = line?.impo?.id ?? "unknown";
      const impoNum = line?.impo?.impo_number ?? "Unknown IMPO";
      const eta     = line?.impo?.eta ?? null;
      const status  = line?.impo?.status ?? "pending";
      if (!map.has(impoId)) map.set(impoId, { impoId, impoNumber: impoNum, eta, status, rows: [] });
      map.get(impoId)!.rows.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.impoNumber.localeCompare(b.impoNumber));
  }, [filtered]);

  const totals = useMemo(() => ({
    qty:      filtered.reduce((s, r) => s + r.qty_requested, 0),
    approved: filtered.reduce((s, r) => s + (r.qty_approved ?? 0), 0),
    deposits: filtered.reduce((s, r) => s + (r.amount_paid ?? 0), 0),
    count:    filtered.length,
  }), [filtered]);

  const activeFilters = [filterImpo, filterStatus, filterSalesperson, filterBrand, filterDateFrom, filterDateTo].filter(Boolean).length;

  function clearFilters() {
    setFilterImpo(""); setFilterStatus(""); setFilterSalesperson("");
    setFilterBrand(""); setFilterDateFrom(""); setFilterDateTo("");
  }

  function printReport() { window.print(); }

  function exportCsv() {
    const rows: (string | number)[][] = [
      ["IMPO", "ETA", "IMPO Status", "SKU", "Brand", "Description",
       "Customer / Entity", "Customer Phone", "Salesperson",
       "Qty Requested", "Qty Approved", "AED Paid", "Payment Method",
       "Quote / SO Ref", "Required By", "Reservation Status", "Date Reserved",
       "Salesperson Notes", "Grace Notes"],
    ];
    for (const r of filtered) {
      const line = r.impo_line as unknown as { item_code?: string; brand?: string | null; description?: string | null; impo?: { impo_number?: string; eta?: string | null; status?: string } } | undefined;
      rows.push([
        line?.impo?.impo_number ?? "",
        line?.impo?.eta ? fmtDate(line.impo.eta) : "",
        line?.impo?.status ?? "",
        line?.item_code ?? "",
        line?.brand ?? "",
        line?.description ?? "",
        r.customer_ref ?? "",
        r.customer_phone ?? "",
        r.requester_name ?? "",
        r.qty_requested,
        r.qty_approved ?? "",
        r.amount_paid ?? 0,
        r.payment_method ?? "",
        r.quote_ref ?? "",
        r.required_by_date ? fmtDate(r.required_by_date) : "",
        r.status,
        r.created_at.slice(0, 10),
        r.notes ?? "",
        r.grace_notes ?? "",
      ]);
    }
    const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `allocation-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const reportDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const emailSubject = `Stock Allocation Report — ${reportDate}`;

  const emailBody = useMemo(() => {
    const lines = [
      `TECHNILINE ELECTRONICS — STOCK ALLOCATION REPORT`,
      `Generated: ${reportDate}`,
      ``,
      `SUMMARY`,
      `  Total Reservations : ${totals.count}`,
      `  Total Qty Requested: ${totals.qty}`,
      `  Total Qty Approved : ${totals.approved}`,
      `  Total Deposits     : AED ${totals.deposits.toLocaleString("en-AE", { maximumFractionDigits: 0 })}`,
      ``,
      `${"─".repeat(70)}`,
    ];
    for (const group of grouped) {
      const gQty   = group.rows.reduce((s, r) => s + r.qty_requested, 0);
      const gApprv = group.rows.reduce((s, r) => s + (r.qty_approved ?? 0), 0);
      const gDep   = group.rows.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
      lines.push(
        ``,
        `IMPO: ${group.impoNumber}  |  ETA: ${fmtDate(group.eta)}  |  Status: ${group.status.replace("_", " ").toUpperCase()}`,
        `Reservations: ${group.rows.length}  |  Units: ${gQty} requested / ${gApprv} approved  |  Deposits: AED ${gDep.toLocaleString("en-AE", { maximumFractionDigits: 0 })}`,
        ``,
      );
      for (const r of group.rows) {
        const l = r.impo_line as unknown as { item_code?: string; brand?: string | null } | undefined;
        const status = r.status.toUpperCase().padEnd(8);
        const sku    = (l?.item_code ?? "—").padEnd(14);
        const cust   = (r.customer_ref ?? "—").padEnd(22);
        const sales  = (r.requester_name ?? "—").padEnd(14);
        const qty    = `${r.qty_requested}${r.qty_approved != null && r.qty_approved !== r.qty_requested ? `→${r.qty_approved}` : ""}`;
        const dep    = r.amount_paid ? ` | AED ${r.amount_paid}` : "";
        const ref    = r.quote_ref ? ` | Ref: ${r.quote_ref}` : "";
        const req    = r.required_by_date ? ` | Req: ${fmtDate(r.required_by_date)}` : "";
        lines.push(`  ${status} ${sku} ${cust} ${sales} Qty: ${qty}${dep}${ref}${req}`);
        if (r.notes) lines.push(`         Notes: ${r.notes}`);
        if (r.grace_notes) lines.push(`         Grace: ${r.grace_notes}`);
      }
      lines.push(`${"─".repeat(70)}`);
    }
    return lines.join("\n");
  }, [grouped, totals, reportDate]);

  const mailtoLink = `mailto:${emailTo}?cc=${emailCc}&subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Filters {activeFilters > 0 && (
              <span className="ml-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">{activeFilters} active</span>
            )}
          </h3>
          {activeFilters > 0 && (
            <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-slate-600">Clear all</button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <select value={filterImpo} onChange={(e) => setFilterImpo(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <option value="">All IMPOs</option>
            {impos.map((i) => <option key={i.id} value={i.id}>{i.impo_number}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={filterSalesperson} onChange={(e) => setFilterSalesperson(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <option value="">All Salespersons</option>
            {salespersons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="text" placeholder="Filter by brand…" value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
            title="From date"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
            title="To date"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>

      {/* Summary + action bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex flex-wrap gap-5 text-sm">
          <span><span className="font-bold text-slate-900 dark:text-slate-100">{totals.count}</span> <span className="text-slate-500">reservations</span></span>
          <span><span className="font-bold text-slate-900 dark:text-slate-100">{totals.qty}</span> <span className="text-slate-500">units requested</span></span>
          <span><span className="font-bold text-green-700">{totals.approved}</span> <span className="text-slate-500">approved</span></span>
          <span><span className="font-bold text-slate-900 dark:text-slate-100">AED {totals.deposits.toLocaleString("en-AE", { maximumFractionDigits: 0 })}</span> <span className="text-slate-500">deposits</span></span>
        </div>
        <div className="flex gap-2">
          <button onClick={printReport} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
          <button
            onClick={() => setShowEmailPanel(!showEmailPanel)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${showEmailPanel ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400"}`}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Report
          </button>
        </div>
      </div>

      {/* Email panel */}
      {showEmailPanel && (
        <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/20">
          <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Email Allocation Report</h4>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500">To</span>
              <input type="email" placeholder="recipient@company.com" value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-500">CC (optional)</span>
              <input type="email" placeholder="cc@company.com" value={emailCc}
                onChange={(e) => setEmailCc(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
            </label>
          </div>
          <div className="mb-3">
            <p className="mb-1 text-xs font-medium text-slate-500">Subject</p>
            <p className="rounded-lg bg-white px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-400">{emailSubject}</p>
          </div>
          <div className="mb-3">
            <p className="mb-1 text-xs font-medium text-slate-500">Preview</p>
            <pre className="max-h-48 overflow-y-auto rounded-lg bg-white px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400 whitespace-pre-wrap">
              {emailBody.slice(0, 800)}{emailBody.length > 800 ? "\n…" : ""}
            </pre>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowEmailPanel(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
            <a href={mailtoLink} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Open in Email Client
            </a>
          </div>
        </div>
      )}

      {/* Report table */}
      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          No reservations match the current filters.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => {
            const gQty   = group.rows.reduce((s, r) => s + r.qty_requested, 0);
            const gApprv = group.rows.reduce((s, r) => s + (r.qty_approved ?? 0), 0);
            const gDep   = group.rows.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
            return (
              <div key={group.impoId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {/* IMPO group header */}
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
                  <svg className="h-4 w-4 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
                  </svg>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-bold text-slate-900 dark:text-slate-100">{group.impoNumber}</span>
                    <span className="text-xs text-slate-500">ETA: {fmtDate(group.eta)}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(group.status)}`}>
                      {group.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-slate-500">{group.rows.length} reservations</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{gQty} req / <span className="text-green-600">{gApprv} approved</span></span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">AED {gDep.toLocaleString("en-AE", { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                      <tr>
                        <th className="px-4 py-2 text-left">SKU</th>
                        <th className="px-4 py-2 text-left">Customer / Entity</th>
                        <th className="px-4 py-2 text-left">Salesperson</th>
                        <th className="px-4 py-2 text-right">Req</th>
                        <th className="px-4 py-2 text-right">Approved</th>
                        <th className="px-4 py-2 text-right">AED Paid</th>
                        <th className="px-4 py-2 text-left">Quote / Ref</th>
                        <th className="px-4 py-2 text-left">Req. By</th>
                        <th className="px-4 py-2 text-left">Status</th>
                        <th className="px-4 py-2 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {group.rows.map((r) => {
                        const line = r.impo_line as unknown as { item_code?: string; brand?: string | null } | undefined;
                        return (
                          <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                            <td className="px-4 py-2.5">
                              <p className="font-semibold text-slate-900 dark:text-slate-100">{line?.item_code ?? "—"}</p>
                              {line?.brand && <p className="text-xs text-slate-400">{line.brand}</p>}
                            </td>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-800 dark:text-slate-200">{r.customer_ref ?? "—"}</p>
                              {r.customer_phone && <p className="text-xs text-slate-400">{r.customer_phone}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{r.requester_name ?? "—"}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-slate-800 dark:text-slate-200">{r.qty_requested}</td>
                            <td className="px-4 py-2.5 text-right">
                              {r.qty_approved != null ? (
                                <span className={`font-bold ${r.qty_approved < r.qty_requested ? "text-amber-600" : "text-green-600"}`}>
                                  {r.qty_approved}
                                </span>
                              ) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">
                              {r.amount_paid ? (
                                <>
                                  <p>AED {r.amount_paid.toLocaleString("en-AE", { maximumFractionDigits: 0 })}</p>
                                  {r.payment_method && <p className="text-xs capitalize text-slate-400">{r.payment_method.replace("_", " ")}</p>}
                                </>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500">{r.quote_ref ?? "—"}</td>
                            <td className="px-4 py-2.5 text-slate-500">{r.required_by_date ? fmtDate(r.required_by_date) : "—"}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(r.status)}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="max-w-[180px] px-4 py-2.5">
                              {r.notes && <p className="truncate text-xs text-slate-500">{r.notes}</p>}
                              {r.grace_notes && <p className="truncate text-xs italic text-indigo-500">{r.grace_notes}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Manager Page ─────────────────────────────────────────────────────────

type ImpoView = "active" | "history";

function ManagerPage() {
  useAuth();

  const freshToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  };

  const [impos, setImpos] = useState<Impo[]>([]);
  const [pending, setPending] = useState<StockReservation[]>([]);
  const [pendingStandalone, setPendingStandalone] = useState<StockReservation[]>([]);
  const [pendingGroups, setPendingGroups] = useState<Map<string, { group: ReservationGroup; lines: StockReservation[] }>>(new Map());
  const [all, setAll] = useState<StockReservation[]>([]);
  const [managerStats, setManagerStats] = useState<{ reservedUnits: number; depositsCollected: number; availableUnits: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [editingEta, setEditingEta] = useState<{ impoId: string; eta: string } | null>(null);
  const [savingEta, setSavingEta] = useState(false);
  const [markingReceived, setMarkingReceived] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"approvals" | "impos" | "activity" | "report">("approvals");
  const [impoView, setImpoView] = useState<ImpoView>("active");
  const [impoHistoryDays, setImpoHistoryDays] = useState<90 | 365 | 0>(90);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, p, a, s, pg] = await Promise.all([fetchImpos(), fetchPendingReservations(), fetchAllReservations(), fetchManagerStats(), fetchPendingGrouped()]);
      setImpos(i); setPending(p); setAll(a); setManagerStats(s);
      setPendingStandalone(pg.standalone);
      setPendingGroups(pg.groups);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const nextEta = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return impos.filter((i) => i.eta != null && i.eta >= today && i.status !== "cancelled")
      .sort((a, b) => a.eta!.localeCompare(b.eta!))[0]?.eta ?? null;
  }, [impos]);

  const arrivingSoon = useMemo(() => {
    const today = new Date();
    const in7 = new Date(today); in7.setDate(today.getDate() + 7);
    const t = today.toISOString().slice(0, 10);
    const e = in7.toISOString().slice(0, 10);
    return impos.filter((i) => i.eta != null && i.eta >= t && i.eta <= e && i.status !== "cancelled" && i.status !== "arrived").length;
  }, [impos]);

  // Active = pending + in_transit; History = arrived + cancelled
  const visibleImpos = useMemo(() => {
    if (impoView === "active") {
      return impos.filter((i) => i.status === "pending" || i.status === "in_transit");
    }
    // history — apply date scope
    const base = impos.filter((i) => i.status === "arrived" || i.status === "cancelled");
    if (impoHistoryDays === 0) return base;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - impoHistoryDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return base.filter((i) => i.created_at.slice(0, 10) >= cutoffStr);
  }, [impos, impoView, impoHistoryDays]);

  const activeImpoCount   = useMemo(() => impos.filter((i) => i.status === "pending" || i.status === "in_transit").length, [impos]);
  const historyImpoCount  = useMemo(() => impos.filter((i) => i.status === "arrived" || i.status === "cancelled").length, [impos]);

  async function saveEta() {
    if (!editingEta) return;
    setSavingEta(true);
    try {
      const tok = await freshToken();
      await fetch("/api/stock-reservation/approve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ impo_id: editingEta.impoId, eta: editingEta.eta }),
      });
      setEditingEta(null); load();
    } finally { setSavingEta(false); }
  }

  async function markReceived(impoId: string) {
    if (!confirm("Mark this shipment as Received? It will move to the History view.")) return;
    setMarkingReceived(impoId);
    try {
      const tok = await freshToken();
      await fetch("/api/stock-reservation/approve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ impo_id: impoId, status: "arrived" }),
      });
      load();
    } finally { setMarkingReceived(null); }
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

  const kpis = [
    { label: "Pending Action",      value: pending.length,                    highlight: pending.length > 0 },
    { label: "Arriving Soon (7d)",  value: arrivingSoon,                      highlight: arrivingSoon > 0 },
    { label: "Reserved Units",      value: managerStats?.reservedUnits ?? "…" },
    { label: "Deposits Collected",  value: managerStats ? `AED ${managerStats.depositsCollected.toLocaleString("en-AE", { maximumFractionDigits: 0 })}` : "…" },
    { label: "Still Available",     value: managerStats?.availableUnits ?? "…" },
  ];

  return (
    <AppShell fullWidth>
      <PageHeader
        title="Stock Reservation — Manager"
        subtitle="Upload shipment sheets, set ETAs, approve requests, and run allocation reports."
        actions={
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload Sheet
          </button>
        }
      />

      {showUpload && (
        <div className="mb-6">
          <UploadPanel onDone={() => { setShowUpload(false); load(); }} />
        </div>
      )}

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`rounded-2xl border p-4 shadow-sm ${kpi.highlight ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{kpi.label}</p>
            <p className={`mt-1 text-xl font-bold leading-tight ${kpi.highlight ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="mb-4 w-fit flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {([
          { key: "approvals", label: `Approvals${pending.length > 0 ? ` (${pending.length})` : ""}` },
          { key: "impos",     label: `IMPO List` },
          { key: "activity",  label: "Activity" },
          { key: "report",    label: "Allocation Report" },
        ] as { key: typeof activeTab; label: string }[]).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === t.key ? "bg-indigo-600 text-white shadow" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Approvals */}
      {activeTab === "approvals" && (
        <div className="space-y-4">
          {pending.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
              No pending approvals. All caught up!
            </div>
          ) : (
            <>
              {/* Multi-SKU group orders */}
              {pendingGroups.size > 0 && (
                <div className="space-y-3">
                  {Array.from(pendingGroups.entries()).map(([gId, { group, lines }]) => (
                    <GroupApprovalCard
                      key={gId}
                      groupId={gId}
                      group={group}
                      reservations={lines}
                      getToken={freshToken}
                      onDone={load}
                    />
                  ))}
                </div>
              )}
              {/* Standalone (single-SKU) reservations */}
              {pendingStandalone.length > 0 && (
                <div className="space-y-3">
                  {pendingGroups.size > 0 && (
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Individual Requests
                    </h3>
                  )}
                  {pendingStandalone.map((r) => <ApprovalCard key={r.id} reservation={r} getToken={freshToken} onDone={load} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab: IMPO List */}
      {activeTab === "impos" && (
        <div>
          {/* Active / History toggle */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              <button onClick={() => setImpoView("active")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${impoView === "active" ? "bg-indigo-600 text-white shadow" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
                Active {activeImpoCount > 0 && `(${activeImpoCount})`}
              </button>
              <button onClick={() => setImpoView("history")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${impoView === "history" ? "bg-indigo-600 text-white shadow" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
                History {historyImpoCount > 0 && `(${historyImpoCount})`}
              </button>
            </div>
            {impoView === "history" && (
              <select value={impoHistoryDays} onChange={(e) => setImpoHistoryDays(Number(e.target.value) as 90 | 365 | 0)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 12 months</option>
                <option value={0}>All time</option>
              </select>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {visibleImpos.length === 0 ? (
              <p className="p-8 text-center text-slate-400">
                {impoView === "active" ? "No active IMPOs. Upload a shipment sheet to get started." : "No received shipments in this date range."}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left">IMPO #</th>
                    <th className="px-4 py-3 text-left">ETA</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">SKUs</th>
                    <th className="px-4 py-3 text-left">Source File</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleImpos.map((impo) => (
                    <tr key={impo.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{impo.impo_number}</td>
                      <td className="px-4 py-3">
                        {editingEta?.impoId === impo.id ? (
                          <div className="flex items-center gap-2">
                            <input type="date" value={editingEta.eta}
                              onChange={(e) => setEditingEta({ ...editingEta, eta: e.target.value })}
                              className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800" />
                            <button onClick={saveEta} disabled={savingEta} className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50">
                              {savingEta ? "…" : "Save"}
                            </button>
                            <button onClick={() => setEditingEta(null)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600 dark:text-slate-400">{fmtDate(impo.eta)}</span>
                            {impoView === "active" && (
                              <button onClick={() => setEditingEta({ impoId: impo.id, eta: impo.eta ?? "" })}
                                className="text-slate-300 transition-colors hover:text-indigo-500" title="Edit ETA">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(impo.status)}`}>
                          {impo.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{impo.total_skus}</td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-xs text-slate-400">{impo.source_file_name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(impo.created_at.slice(0, 10))}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <a href={`/stock-reservation/manager/lines?impo=${impo.id}`} className="text-xs text-indigo-500 hover:underline">View lines →</a>
                          {impoView === "active" && (
                            <button
                              onClick={() => markReceived(impo.id)}
                              disabled={markingReceived === impo.id}
                              className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              {markingReceived === impo.id ? "…" : "Mark Received"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tab: Activity */}
      {activeTab === "activity" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {all.length === 0 ? (
            <p className="p-8 text-center text-slate-400">No reservation activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Salesperson</th>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-left">IMPO</th>
                    <th className="px-4 py-3 text-left">Customer / Entity</th>
                    <th className="px-4 py-3 text-right">Req</th>
                    <th className="px-4 py-3 text-right">Approved</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {all.map((r) => {
                    const line = r.impo_line as unknown as { item_code?: string; impo?: { impo_number?: string } } | undefined;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(r.created_at.slice(0, 10))}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.requester_name ?? "—"}</td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{line?.item_code ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{line?.impo?.impo_number ?? "—"}</td>
                        <td className="px-4 py-3">
                          <p className="text-slate-700 dark:text-slate-300">{r.customer_ref ?? "—"}</p>
                          {r.customer_phone && <p className="text-xs text-slate-400">{r.customer_phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">{r.qty_requested}</td>
                        <td className="px-4 py-3 text-right font-medium text-green-600">{r.qty_approved ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {r.amount_paid ? `AED ${r.amount_paid.toLocaleString("en-AE", { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Allocation Report */}
      {activeTab === "report" && <ReportTab reservations={all} impos={impos} />}
    </AppShell>
  );
}

export default function Page() {
  return (
    <RouteGuard requireCapability="stock_reservation_manager">
      <ManagerPage />
    </RouteGuard>
  );
}
