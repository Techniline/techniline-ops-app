"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { useAuth } from "@/app/providers/AuthProvider";
import { RouteGuard } from "@/components/RouteGuard";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchImpos,
  fetchAllReservations,
  fetchPendingReservations,
} from "@/lib/stock-reservation";
import type { Impo, StockReservation, UploadPreviewLine, UploadConfirmPayload } from "@/lib/stock-reservation";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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

interface UploadPanelProps {
  token: string;
  onDone: () => void;
}

interface ParsedPreview {
  impo_number: string;
  vendor: string | null;
  po_date: string | null;
  lines: UploadPreviewLine[];
  file_name: string;
}

function UploadPanel({ token, onDone }: UploadPanelProps) {
  const [step, setStep] = useState<"select" | "preview" | "saving">("select");
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [editedImpo, setEditedImpo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/stock-reservation/upload?action=preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json() as ParsedPreview & { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Upload failed."); return; }
      setPreview(data);
      setEditedImpo(data.impo_number ?? "");
      setStep("preview");
    } catch {
      setError("Network error during upload.");
    } finally {
      setUploading(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setStep("saving");
    setError(null);
    const payload: UploadConfirmPayload = {
      impo_number: editedImpo.trim(),
      lines: preview.lines,
      source_file_name: preview.file_name,
    };
    try {
      const res = await fetch("/api/stock-reservation/upload?action=confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Confirm failed."); setStep("preview"); return; }
      onDone();
    } catch {
      setError("Network error during save.");
      setStep("preview");
    }
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
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <svg className="h-6 w-6 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <p className="text-sm text-slate-500">Parsing PDF…</p>
          </div>
        ) : (
          <>
            <svg className="mx-auto mb-3 h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Drop Purchase Order PDF here or click to browse</p>
            <p className="mt-1 text-xs text-slate-400">One PDF per IMPO · IMPO number is read from the document automatically</p>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // Preview step
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Review & Confirm</h3>
          <p className="text-sm text-slate-400">
            {preview?.file_name}
            {preview?.vendor && <> · {preview.vendor}</>}
            {preview?.po_date && <> · PO date: {preview.po_date}</>}
            {" · "}{preview?.lines.length ?? 0} SKUs
          </p>
        </div>
        <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-700">Back</button>
      </div>

      <div className="mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">IMPO Number <span className="text-slate-400">(extracted from document — edit if needed)</span></span>
          <input
            type="text"
            value={editedImpo}
            onChange={(e) => setEditedImpo(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
        <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 inline-block">
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
                <td className="px-3 py-1.5 text-slate-500 max-w-xs truncate">{l.description ?? "—"}</td>
                <td className="px-3 py-1.5 text-right font-medium text-slate-700 dark:text-slate-300">{l.qty_incoming}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={reset} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Cancel</button>
        <button
          onClick={confirm}
          disabled={step === "saving" || !editedImpo.trim() || !preview?.lines.length}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {step === "saving" ? "Saving…" : `Save ${preview?.lines.length ?? 0} SKUs`}
        </button>
      </div>
    </div>
  );
}

// ── Approval Card ─────────────────────────────────────────────────────────────

interface ApprovalCardProps {
  reservation: StockReservation;
  token: string;
  onDone: () => void;
}

function ApprovalCard({ reservation: res, token, onDone }: ApprovalCardProps) {
  const [qty, setQty] = useState(res.qty_requested);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const line = res.impo_line as unknown as { item_code?: string; description?: string; qty_incoming?: number; impo?: { impo_number?: string; eta?: string } } | undefined;

  async function act(action: "approve" | "reject") {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/stock-reservation/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reservation_id: res.id, action, qty_approved: action === "approve" ? qty : undefined, grace_notes: notes.trim() || undefined }),
      });
      const data = await r.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Failed."); return; }
      onDone();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {res.requester_name ?? "User"} · {line?.item_code ?? "—"}
          </p>
          <p className="text-sm text-slate-500">
            {line?.impo?.impo_number ?? "—"} · ETA {line?.impo?.eta ? fmtDate(line.impo.eta) : "—"}
            {res.customer_ref && <> · <span className="text-indigo-600">{res.customer_ref}</span></>}
          </p>
          {res.notes && <p className="mt-1 text-xs text-slate-400 italic">{res.notes}</p>}
        </div>
        <span className="shrink-0 text-sm font-bold text-slate-700 dark:text-slate-300">{res.qty_requested} unit{res.qty_requested !== 1 ? "s" : ""} requested</span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Approve qty</span>
          <input
            type="number"
            min={1}
            max={res.qty_requested}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
            className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 min-w-[160px]">
          <span className="text-xs font-medium text-slate-500">Note (optional)</span>
          <input
            type="text"
            placeholder="Reason or note to requester…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <div className="flex gap-2 self-end">
          <button
            onClick={() => act("reject")}
            disabled={saving}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => act("approve")}
            disabled={saving || qty < 1}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Approve"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ── Main Manager Page ─────────────────────────────────────────────────────────

function ManagerPage() {
  useAuth(); // ensure auth context is initialized
  const [token, setToken] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? "");
    });
  }, []);

  const [impos, setImpos] = useState<Impo[]>([]);
  const [pending, setPending] = useState<StockReservation[]>([]);
  const [all, setAll] = useState<StockReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [editingEta, setEditingEta] = useState<{ impoId: string; eta: string } | null>(null);
  const [savingEta, setSavingEta] = useState(false);
  const [activeTab, setActiveTab] = useState<"approvals" | "impos" | "activity">("approvals");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, p, a] = await Promise.all([fetchImpos(), fetchPendingReservations(), fetchAllReservations()]);
      setImpos(i);
      setPending(p);
      setAll(a);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const nextEta = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = impos.filter((i) => i.eta != null && i.eta >= today && i.status !== "cancelled").sort((a, b) => a.eta!.localeCompare(b.eta!));
    return upcoming[0]?.eta ?? null;
  }, [impos]);

  async function saveEta() {
    if (!editingEta) return;
    setSavingEta(true);
    try {
      await fetch("/api/stock-reservation/approve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ impo_id: editingEta.impoId, eta: editingEta.eta }),
      });
      setEditingEta(null);
      load();
    } finally {
      setSavingEta(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
      </div>
    );
  }

  const totalSkus = impos.reduce((s, i) => s + i.total_skus, 0);

  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950 md:p-6">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/dashboard" className="hover:text-slate-600 dark:hover:text-slate-200">Dashboard</Link>
        <span>/</span>
        <Link href="/stock-reservation" className="hover:text-slate-600 dark:hover:text-slate-200">Stock Reservation</Link>
        <span>/</span>
        <span className="text-slate-600 dark:text-slate-300">Manager</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Stock Reservation — Manager</h1>
          <p className="mt-1 text-sm text-slate-500">Upload shipment sheets, set ETAs, and approve reservation requests.</p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          Upload Sheet
        </button>
      </div>

      {/* Upload panel (inline, expands) */}
      {showUpload && (
        <div className="mb-6">
          <UploadPanel token={token} onDone={() => { setShowUpload(false); load(); }} />
        </div>
      )}

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Active IMPOs", value: impos.filter((i) => i.status !== "cancelled").length },
          { label: "Total SKUs", value: totalSkus },
          { label: "Pending Approvals", value: pending.length, highlight: pending.length > 0 },
          { label: "Next ETA", value: nextEta ? fmtDate(nextEta) : "—" },
        ].map((kpi) => (
          <div key={kpi.label} className={`rounded-2xl border p-4 shadow-sm ${kpi.highlight ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{kpi.label}</p>
            <p className={`mt-1 text-2xl font-bold ${kpi.highlight ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900 w-fit">
        {([
          { key: "approvals", label: `Approvals${pending.length > 0 ? ` (${pending.length})` : ""}` },
          { key: "impos", label: `IMPO List (${impos.length})` },
          { key: "activity", label: "Activity" },
        ] as { key: typeof activeTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Pending Approvals */}
      {activeTab === "approvals" && (
        <div>
          {pending.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
              No pending approvals. All caught up!
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <ApprovalCard key={r.id} reservation={r} token={token} onDone={load} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: IMPO List */}
      {activeTab === "impos" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {impos.length === 0 ? (
            <p className="p-8 text-center text-slate-400">No IMPOs uploaded yet.</p>
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
                {impos.map((impo) => (
                  <tr key={impo.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{impo.impo_number}</td>
                    <td className="px-4 py-3">
                      {editingEta?.impoId === impo.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={editingEta.eta}
                            onChange={(e) => setEditingEta({ ...editingEta, eta: e.target.value })}
                            className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                          />
                          <button onClick={saveEta} disabled={savingEta} className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50">
                            {savingEta ? "…" : "Save"}
                          </button>
                          <button onClick={() => setEditingEta(null)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600 dark:text-slate-400">{fmtDate(impo.eta)}</span>
                          <button
                            onClick={() => setEditingEta({ impoId: impo.id, eta: impo.eta ?? "" })}
                            className="text-slate-300 hover:text-indigo-500 transition-colors"
                            title="Edit ETA"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(impo.status)}`}>
                        {impo.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">{impo.total_skus}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[160px] truncate">{impo.source_file_name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(impo.created_at.slice(0, 10))}</td>
                    <td className="px-4 py-3 text-right">
                      <a href={`/stock-reservation?impo=${impo.id}`} className="text-xs text-indigo-500 hover:underline">View lines →</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Activity log */}
      {activeTab === "activity" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {all.length === 0 ? (
            <p className="p-8 text-center text-slate-400">No reservation activity yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Requested by</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-left">IMPO</th>
                  <th className="px-4 py-3 text-right">Req</th>
                  <th className="px-4 py-3 text-right">Approved</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Notes</th>
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
                      <td className="px-4 py-3 text-right text-slate-600">{r.qty_requested}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">{r.qty_approved ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{r.customer_ref ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-[160px] truncate">{r.grace_notes ?? r.notes ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <RouteGuard requireCapability="stock_reservation_manager">
      <ManagerPage />
    </RouteGuard>
  );
}
