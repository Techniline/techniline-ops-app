"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode, WheelEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, btnSmall, inputClass, surface } from "@/components/ui";
import { isManager } from "@/lib/permissions";
import {
  ENTITY_OPTIONS,
  buildStockSnapshot,
  computeLpSummary,
  computePriceAlerts,
  fetchLpItems,
  fetchSaleHistory,
  listLpPdfs,
  lpPdfUrl,
  parseLpViaApi,
  recordSale,
  renderStockReportHtml,
  saveVerifiedLp,
  searchLp,
  updateLpItem,
  type CaptureEngine,
  type EntityOption,
  type LpDraft,
  type LpItemRow,
  type LpSaleRow,
  type PriceAlert,
  type StoredLpPdf,
  type VerifiedLpLine,
} from "@/lib/lp";
import { supabase } from "@/lib/supabaseClient";

/* ------------------------------- helpers ------------------------------- */

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
function blurOnWheel(event: WheelEvent<HTMLInputElement>): void {
  event.currentTarget.blur();
}
function dash(v: string | null): string {
  return v ?? "—";
}
function fmtNum(v: number | null): string {
  return v == null ? "—" : v.toLocaleString();
}
function fmtCost(v: number | null): string {
  return v == null
    ? "—"
    : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const AGEING_STYLES: Record<string, string> = {
  safe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  monitor: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  warning: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  action_required: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};
function AgeingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const style =
    AGEING_STYLES[status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PriceBadge({ alert }: { alert: PriceAlert }) {
  const up = alert.direction === "up";
  const style = up
    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}
      title={`Was ${fmtCost(alert.previousPrice)}${alert.previousLpNumber ? ` on ${alert.previousLpNumber}` : ""}`}
    >
      {up ? "▲" : "▼"} {Math.abs(alert.pct).toFixed(1)}%
    </span>
  );
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className={`my-auto max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6 dark:border-slate-800 dark:bg-slate-900 ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* --------------------- Verify (capture) LP modal ----------------------- */

interface VerifyLine {
  lineNumber: number | null;
  brand: string;
  modelNo: string;
  description: string;
  qty: string;
  origQty: string; // parsed original — used to detect manual changes
  qtyComment: string;
  unitPrice: string;
  amount: string;
  discAmount: string;
}

function draftToLines(draft: LpDraft): VerifyLine[] {
  return draft.lineItems.map((li) => ({
    lineNumber: li.lineNumber,
    brand: li.brand ?? "",
    modelNo: li.modelNo ?? "",
    description: li.description ?? "",
    qty: li.qty != null ? String(li.qty) : "",
    origQty: li.qty != null ? String(li.qty) : "",
    qtyComment: "",
    unitPrice: li.unitPrice != null ? String(li.unitPrice) : "",
    amount: li.amount != null ? String(li.amount) : "",
    discAmount: li.discAmount != null ? String(li.discAmount) : "",
  }));
}

function VerifyLpModal({
  file,
  draft,
  engine,
  createdBy,
  onClose,
  onSaved,
}: {
  file: File;
  draft: LpDraft;
  engine: CaptureEngine;
  createdBy: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [lpNumber, setLpNumber] = useState(draft.lpNumber ?? "");
  const [lpDate, setLpDate] = useState(draft.lpDate ?? "");
  const [vendorName, setVendorName] = useState(draft.vendorName ?? "");
  const [vendorTrn, setVendorTrn] = useState(draft.vendorTrn ?? "");
  const [terms, setTerms] = useState(draft.terms ?? "");
  const [lines, setLines] = useState<VerifyLine[]>(draftToLines(draft));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function updateLine(index: number, key: keyof VerifyLine, value: string): void {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [key]: value } : l)));
  }
  function addLine(): void {
    setLines((prev) => [
      ...prev,
      { lineNumber: null, brand: "", modelNo: "", description: "", qty: "", origQty: "", qtyComment: "", unitPrice: "", amount: "", discAmount: "" },
    ]);
  }
  function removeLine(index: number): void {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (lpNumber.trim() === "") return setFormError("LP Number is required.");
    if (lpDate.trim() === "") return setFormError("LP Date is required.");
    if (vendorName.trim() === "") return setFormError("Vendor is required.");
    if (lines.length === 0) return setFormError("Add at least one line item.");

    const verified: VerifiedLpLine[] = [];
    for (const [i, l] of lines.entries()) {
      if (l.modelNo.trim() === "") return setFormError(`Line ${i + 1}: Model No is required.`);
      const qty = Number(l.qty);
      if (l.qty.trim() === "" || !Number.isFinite(qty) || qty < 0) {
        return setFormError(`Line ${i + 1}: Qty must be a non-negative number.`);
      }
      const origQty = l.origQty.trim() === "" ? null : Number(l.origQty);
      const changed = origQty != null && qty !== origQty;
      if (changed && l.qtyComment.trim() === "") {
        return setFormError(`Line ${i + 1}: a comment is required when changing the quantity from ${origQty}.`);
      }
      const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
      verified.push({
        lineNumber: l.lineNumber,
        brand: l.brand.trim() || null,
        modelNo: l.modelNo.trim(),
        description: l.description.trim() || null,
        qtyPurchased: qty,
        qtyOriginal: origQty,
        qtyAdjustComment: changed ? l.qtyComment.trim() : null,
        unitPrice: numOrNull(l.unitPrice),
        amount: numOrNull(l.amount),
        discAmount: numOrNull(l.discAmount) ?? 0,
      });
    }

    setSaving(true);
    try {
      const { uploadLpPdf } = await import("@/lib/lp");
      const pdfPath = await uploadLpPdf(file);
      const count = await saveVerifiedLp({
        lpNumber: lpNumber.trim(),
        lpDate,
        vendorName: vendorName.trim(),
        vendorTrn: vendorTrn.trim() || null,
        consigneeTrn: draft.consigneeTrn,
        qtnRef: draft.qtnRef,
        amountBeforeVat: draft.amountBeforeVat,
        vatAmount: draft.vatAmount,
        netAmount: draft.netAmount,
        terms: terms.trim() || null,
        notes: null,
        pdfPath,
        createdBy,
        lineItems: verified,
      });
      onSaved(`LP saved — ${count} line item${count === 1 ? "" : "s"} recorded.`);
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Verify LP — auto-captured from PDF" onClose={onClose} wide>
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        {engine === "ai" ? "✨ AI-captured" : "Basic capture (free) — review line items carefully"} from{" "}
        <span className="font-medium">{file.name}</span>. Check every field, correct anything wrong, then save.
        Changing a captured quantity requires a reason.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">LP details</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormRow label="LP Number *">
              <input className={inputClass} value={lpNumber} onChange={(e) => setLpNumber(e.target.value)} required />
            </FormRow>
            <FormRow label="LP Date *">
              <input type="date" className={inputClass} value={lpDate} onChange={(e) => setLpDate(e.target.value)} required />
            </FormRow>
            <FormRow label="Terms">
              <input className={inputClass} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </FormRow>
            <FormRow label="Vendor *">
              <input className={inputClass} value={vendorName} onChange={(e) => setVendorName(e.target.value)} required />
            </FormRow>
            <FormRow label="Vendor TRN">
              <input className={inputClass} value={vendorTrn} onChange={(e) => setVendorTrn(e.target.value)} />
            </FormRow>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Line items ({lines.length})</p>
            <button type="button" onClick={addLine} className={btnSmall}>+ Add line</button>
          </div>
          <div className="flex flex-col gap-3">
            {lines.map((l, i) => {
              const qtyChanged = l.origQty.trim() !== "" && l.qty !== l.origQty;
              return (
                <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/30">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">Line {i + 1}</span>
                    <button type="button" onClick={() => removeLine(i)} className="text-xs font-medium text-red-500 hover:text-red-700">Remove</button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <label className="flex flex-col gap-1 text-sm sm:col-span-3">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Model No *</span>
                      <input className={inputClass} value={l.modelNo} onChange={(e) => updateLine(i, "modelNo", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Brand</span>
                      <input className={inputClass} value={l.brand} onChange={(e) => updateLine(i, "brand", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-3">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Description</span>
                      <input className={inputClass} value={l.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-1">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Qty *</span>
                      <input type="number" min="0" step="1" onWheel={blurOnWheel} className={inputClass} value={l.qty} onChange={(e) => updateLine(i, "qty", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Unit Price</span>
                      <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={l.unitPrice} onChange={(e) => updateLine(i, "unitPrice", e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-1">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Disc</span>
                      <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={l.discAmount} onChange={(e) => updateLine(i, "discAmount", e.target.value)} />
                    </label>
                  </div>
                  {qtyChanged ? (
                    <label className="mt-2 flex flex-col gap-1 text-sm">
                      <span className="font-medium text-amber-700 dark:text-amber-300">Reason for qty change (from {l.origQty}) *</span>
                      <input className={inputClass} value={l.qtyComment} onChange={(e) => updateLine(i, "qtyComment", e.target.value)} placeholder="e.g. short delivery — 2 units not received" />
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {formError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{formError}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Verify & Save"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ------------------------------ Record sale ---------------------------- */

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RecordSaleModal({
  row,
  recordedBy,
  onClose,
  onSaved,
}: {
  row: LpItemRow;
  recordedBy: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const remaining = row.qty_remaining ?? 0;
  const [soldQty, setSoldQty] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [entity, setEntity] = useState<EntityOption>("Al Shoala");
  const [entityOther, setEntityOther] = useState("");
  const [salesman, setSalesman] = useState("");
  const [saleDate, setSaleDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const qty = Number(soldQty);
    if (soldQty.trim() === "" || !Number.isFinite(qty) || qty <= 0) {
      return setFormError("Sold quantity must be a positive number.");
    }
    if (qty > remaining) {
      return setFormError(`Sold quantity cannot exceed the ${remaining} remaining.`);
    }
    if (entity === "Other" && entityOther.trim() === "") {
      return setFormError("Enter the entity name (Other selected).");
    }
    if (!row.id) return setFormError("This line cannot be updated (missing id).");

    setSaving(true);
    try {
      await recordSale({
        lpItemId: row.id,
        soldQty: qty,
        invoiceNumber: invoiceNumber.trim() || null,
        entity,
        entityOther: entityOther.trim() || null,
        salesmanName: salesman.trim() || null,
        saleDate,
        notes: notes.trim() || null,
        recordedBy,
      });
      onSaved("Sale recorded.");
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Record sale" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">
        <span className="font-medium text-slate-700 dark:text-slate-300">{row.model_no ?? row.sku ?? "—"}</span>
        {" · "}{row.lp_number ?? "—"} · {remaining.toLocaleString()} remaining
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormRow label="Sold Qty *">
            <input type="number" min="0" step="1" onWheel={blurOnWheel} className={inputClass} value={soldQty} onChange={(e) => setSoldQty(e.target.value)} required />
          </FormRow>
          <FormRow label="Invoice Number">
            <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </FormRow>
          <FormRow label="Entity *">
            <select className={inputClass} value={entity} onChange={(e) => setEntity(e.target.value as EntityOption)}>
              {ENTITY_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </FormRow>
          {entity === "Other" ? (
            <FormRow label="Entity name *">
              <input className={inputClass} value={entityOther} onChange={(e) => setEntityOther(e.target.value)} />
            </FormRow>
          ) : (
            <FormRow label="Salesman">
              <input className={inputClass} value={salesman} onChange={(e) => setSalesman(e.target.value)} />
            </FormRow>
          )}
          {entity === "Other" ? (
            <FormRow label="Salesman">
              <input className={inputClass} value={salesman} onChange={(e) => setSalesman(e.target.value)} />
            </FormRow>
          ) : null}
          <FormRow label="Sale Date">
            <input type="date" className={inputClass} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </FormRow>
        </div>
        <FormRow label="Notes">
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormRow>

        {formError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{formError}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Record sale"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

/* --------------------------- Manager edit line ------------------------- */

function EditLpItemModal({
  row,
  onClose,
  onSaved,
}: {
  row: LpItemRow;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const origQty = row.qty_purchased ?? 0;
  const [form, setForm] = useState({
    brand: row.brand ?? "",
    modelNo: row.model_no ?? row.sku ?? "",
    description: row.description ?? "",
    qtyPurchased: row.qty_purchased != null ? String(row.qty_purchased) : "",
    qtyComment: "",
    unitPrice: row.unit_price != null ? String(row.unit_price) : "",
    amount: row.amount != null ? String(row.amount) : "",
    discAmount: row.disc_amount != null ? String(row.disc_amount) : "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function update(key: keyof typeof form, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (!row.id) return setFormError("This line cannot be edited (missing id).");
    if (form.modelNo.trim() === "") return setFormError("Model No is required.");
    const qty = Number(form.qtyPurchased);
    if (!Number.isFinite(qty) || qty < 0) return setFormError("Qty must be a non-negative number.");
    const changed = qty !== origQty;
    if (changed && form.qtyComment.trim() === "") {
      return setFormError(`A comment is required when changing the quantity from ${origQty}.`);
    }
    const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

    setSaving(true);
    try {
      await updateLpItem({
        id: row.id,
        brand: form.brand.trim() || null,
        modelNo: form.modelNo.trim(),
        description: form.description.trim() || null,
        qtyPurchased: qty,
        qtyAdjustComment: changed ? form.qtyComment.trim() : row.qty_adjust_comment ?? null,
        unitPrice: numOrNull(form.unitPrice),
        amount: numOrNull(form.amount),
        discAmount: numOrNull(form.discAmount),
      });
      onSaved("Line updated.");
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  const qtyChanged = form.qtyPurchased.trim() !== "" && Number(form.qtyPurchased) !== origQty;

  return (
    <ModalShell title="Edit line (manager)" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormRow label="Model No *">
            <input className={inputClass} value={form.modelNo} onChange={(e) => update("modelNo", e.target.value)} required />
          </FormRow>
          <FormRow label="Brand">
            <input className={inputClass} value={form.brand} onChange={(e) => update("brand", e.target.value)} />
          </FormRow>
          <FormRow label="Description">
            <input className={inputClass} value={form.description} onChange={(e) => update("description", e.target.value)} />
          </FormRow>
          <FormRow label="Qty Purchased *">
            <input type="number" min="0" step="1" onWheel={blurOnWheel} className={inputClass} value={form.qtyPurchased} onChange={(e) => update("qtyPurchased", e.target.value)} required />
          </FormRow>
          <FormRow label="Unit Price">
            <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} />
          </FormRow>
          <FormRow label="Disc Amount">
            <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={form.discAmount} onChange={(e) => update("discAmount", e.target.value)} />
          </FormRow>
        </div>
        {qtyChanged ? (
          <FormRow label={`Reason for qty change (from ${origQty}) *`}>
            <input className={inputClass} value={form.qtyComment} onChange={(e) => update("qtyComment", e.target.value)} />
          </FormRow>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{formError}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

/* --------------------------- Stored PDFs browser ----------------------- */

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function LpPdfsModal({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<StoredLpPdf[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listLpPdfs();
        if (active) setFiles(list);
      } catch (e) {
        if (active) setErr(errorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function openFile(path: string, download?: string): Promise<void> {
    const url = await lpPdfUrl(path, download);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <ModalShell title="Stored LP PDFs" onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : err ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-slate-500">No LP PDFs stored yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/40">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-500">File</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Uploaded</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Size</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.path} className="border-t border-slate-100 dark:border-slate-800/60">
                  <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300" title={f.name}>{f.name}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{f.createdAt ? new Date(f.createdAt).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => void openFile(f.path)} className={btnSmall}>View</button>
                      <button type="button" onClick={() => void openFile(f.path, f.name)} className={btnSmall}>Download</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------ Summary -------------------------------- */

function SummaryCards({ rows, alertCount }: { rows: LpItemRow[]; alertCount: number }) {
  const s = useMemo(() => computeLpSummary(rows), [rows]);
  const cards: ReadonlyArray<{ label: string; value: string; tone?: string }> = [
    { label: "Open LPs", value: s.openLpCount.toLocaleString() },
    { label: "Open Lines", value: s.openLines.toLocaleString() },
    { label: "Qty In Hand", value: s.totalRemainingQty.toLocaleString() },
    { label: "Value In Hand (AED)", value: fmtCost(s.totalRemainingValue) },
    { label: "Aged 90+ Lines", value: s.aged90Lines.toLocaleString(), tone: s.aged90Lines > 0 ? "text-red-600 dark:text-red-400" : undefined },
    { label: "Price Alerts", value: alertCount.toLocaleString(), tone: alertCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div key={card.label} className={`${surface} p-4`}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${card.tone ?? "text-slate-900 dark:text-slate-100"}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Table --------------------------------- */

const TH = "whitespace-nowrap px-3 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400";
const TD = "whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-300";

function SaleHistory({ itemId }: { itemId: string }) {
  const [sales, setSales] = useState<LpSaleRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await fetchSaleHistory(itemId);
        if (active) setSales(list);
      } catch (e) {
        if (active) setErr(errorMessage(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [itemId]);

  if (err) return <p className="px-3 py-2 text-xs text-red-600">{err}</p>;
  if (sales === null) return <p className="px-3 py-2 text-xs text-slate-400">Loading sales…</p>;
  if (sales.length === 0) return <p className="px-3 py-2 text-xs text-slate-400">No sales recorded yet.</p>;
  return (
    <div className="px-3 py-2">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Sale history</p>
      <ul className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
        {sales.map((s) => (
          <li key={s.id} className="flex flex-wrap gap-x-3">
            <span className="font-medium">{s.sold_qty} sold</span>
            <span>{s.sale_date ?? "—"}</span>
            <span>{s.entity === "Other" ? s.entity_other ?? "Other" : s.entity ?? "—"}</span>
            {s.invoice_number ? <span>inv {s.invoice_number}</span> : null}
            {s.salesman_name ? <span>by {s.salesman_name}</span> : null}
            {s.notes ? <span className="text-slate-400">— {s.notes}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LpTable({
  rows,
  alerts,
  managerFlag,
  onSale,
  onEdit,
}: {
  rows: LpItemRow[];
  alerts: Map<string, PriceAlert>;
  managerFlag: boolean;
  onSale: (row: LpItemRow) => void;
  onEdit: (row: LpItemRow) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  async function openPdf(path: string): Promise<void> {
    const url = await lpPdfUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <div className={`${surface} overflow-x-auto`}>
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
          <tr>
            <th className={TH}>LP Number</th>
            <th className={TH}>LP Date</th>
            <th className={TH}>Vendor</th>
            <th className={TH}>Model / SKU</th>
            <th className={TH}>Brand</th>
            <th className={TH}>Purchased</th>
            <th className={TH}>Sold</th>
            <th className={TH}>Remaining</th>
            <th className={TH}>Unit Price</th>
            <th className={TH}>Price Δ</th>
            <th className={TH}>Age (d)</th>
            <th className={TH}>Status</th>
            <th className={TH}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const id = row.id ?? `row-${index}`;
            const alert = row.id ? alerts.get(row.id) : undefined;
            const remaining = row.qty_remaining ?? 0;
            const isExpanded = expanded === id;
            return (
              <Fragment key={id}>
                <tr
                  onClick={() => row.id && setExpanded(isExpanded ? null : row.id)}
                  className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30"
                >
                  <td className={`${TD} font-medium text-slate-900 dark:text-slate-100`}>
                    <span className="inline-flex items-center gap-1.5">
                      {dash(row.lp_number)}
                      {row.pdf_url ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void openPdf(row.pdf_url!); }}
                          className="text-indigo-500 hover:text-indigo-700"
                          title="View LP PDF"
                          aria-label="View LP PDF"
                        >
                          📎
                        </button>
                      ) : null}
                    </span>
                  </td>
                  <td className={TD}>{dash(row.lp_date)}</td>
                  <td className={`${TD} max-w-[160px] truncate`} title={row.vendor_name ?? ""}>{dash(row.vendor_name)}</td>
                  <td className={TD}>{dash(row.model_no ?? row.sku)}</td>
                  <td className={TD}>{dash(row.brand)}</td>
                  <td className={TD}>{fmtNum(row.qty_purchased)}</td>
                  <td className={TD}>{fmtNum(row.qty_sold)}</td>
                  <td className={`${TD} font-medium`}>{fmtNum(row.qty_remaining)}</td>
                  <td className={TD}>{fmtCost(row.unit_price)}</td>
                  <td className={TD}>{alert ? <PriceBadge alert={alert} /> : <span className="text-slate-300">—</span>}</td>
                  <td className={TD}>{fmtNum(row.ageing_days)}</td>
                  <td className={TD}><AgeingBadge status={row.ageing_status} /></td>
                  <td className={TD}>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSale(row); }}
                        disabled={!row.id || remaining <= 0}
                        className={btnSmall}
                      >
                        Record sale
                      </button>
                      {managerFlag ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onEdit(row); }}
                          disabled={!row.id}
                          className={btnSmall}
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {isExpanded && row.id ? (
                  <tr className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800/60 dark:bg-slate-800/20">
                    <td colSpan={13}>
                      {row.qty_adjust_comment ? (
                        <p className="px-3 pt-2 text-xs text-amber-700 dark:text-amber-300">⚑ Qty note: {row.qty_adjust_comment}</p>
                      ) : null}
                      {row.description ? (
                        <p className="px-3 pt-2 text-xs text-slate-500">{row.description}</p>
                      ) : null}
                      <SaleHistory itemId={row.id} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Content -------------------------------- */

function LpContent() {
  const { profile } = useAuth();
  const managerFlag = isManager(profile);

  const [rows, setRows] = useState<LpItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [saleRow, setSaleRow] = useState<LpItemRow | null>(null);
  const [editRow, setEditRow] = useState<LpItemRow | null>(null);
  const [showPdfs, setShowPdfs] = useState(false);
  const [review, setReview] = useState<{ file: File; draft: LpDraft; engine: CaptureEngine } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = q && q.trim() !== "" ? await searchLp(q) : await fetchLpItems();
      setRows(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const alerts = useMemo(() => computePriceAlerts(rows), [rows]);

  async function handleFileChosen(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setUploadError("Please choose a PDF LP.");
      return;
    }
    setUploadError(null);
    setBanner(null);
    setParsing(true);
    try {
      const { draft, engine } = await parseLpViaApi(file);
      setReview({ file, draft, engine });
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setParsing(false);
    }
  }

  function handleSaved(message: string) {
    setSaleRow(null);
    setEditRow(null);
    setReview(null);
    setBanner(message);
    void load(query);
  }

  function buildReportHtml(): string {
    const snapshot = buildStockSnapshot(rows);
    return renderStockReportHtml(snapshot, new Date().toLocaleString());
  }

  function exportPdf(): void {
    const html = buildReportHtml();
    const w = window.open("", "_blank");
    if (!w) {
      setUploadError("Pop-up blocked — allow pop-ups to export the report.");
      return;
    }
    w.document.write(`<!doctype html><html><head><title>LP Stock in Hand</title></head><body>${html}<script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  }

  async function sendReport(): Promise<void> {
    setSending(true);
    setUploadError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const res = await fetch("/api/lp/send-report", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ["impex@techniline.org"],
          subject: `LP Stock in Hand — ${new Date().toLocaleDateString()}`,
          html: buildReportHtml(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) {
        setBanner("Stock report emailed to impex@techniline.org.");
      } else {
        setUploadError(`Could not send report: ${j.error ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="LP Tracker"
        subtitle="Local purchase stock — ageing, draw-down, and price alerts."
        actions={
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleFileChosen} />
            <button type="button" onClick={() => { setUploadError(null); fileInputRef.current?.click(); }} disabled={parsing} className={btnSecondary}>
              {parsing ? "Reading LP…" : "Upload LP (PDF)"}
            </button>
            <button type="button" onClick={() => setShowPdfs(true)} className={btnSecondary}>LP PDFs</button>
            <button type="button" onClick={exportPdf} className={btnSecondary}>Export PDF</button>
            <button type="button" onClick={() => void sendReport()} disabled={sending} className={btnPrimary}>
              {sending ? "Sending…" : "Send stock report"}
            </button>
          </div>
        }
      />

      {banner ? (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
      ) : null}
      {uploadError ? (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <span>{uploadError}</span>
          <button type="button" onClick={() => setUploadError(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
      ) : null}

      <form
        onSubmit={(e) => { e.preventDefault(); void load(query); }}
        className="mb-4 flex gap-2"
      >
        <input
          className={inputClass}
          placeholder="Search by vendor, LP number, or SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className={btnSecondary}>Search</button>
        {query ? (
          <button type="button" onClick={() => { setQuery(""); void load(); }} className={btnSecondary}>Clear</button>
        ) : null}
      </form>

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading LP tracker…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button type="button" onClick={() => void load(query)} className={`${btnSecondary} mt-3`}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">
            {query ? "No matching LP lines." : "No local purchases yet. Upload an LP PDF to get started."}
          </p>
        </div>
      ) : (
        <>
          <SummaryCards rows={rows} alertCount={alerts.size} />
          <LpTable
            rows={rows}
            alerts={alerts}
            managerFlag={managerFlag}
            onSale={(row) => setSaleRow(row)}
            onEdit={(row) => setEditRow(row)}
          />
        </>
      )}

      {review && profile ? (
        <VerifyLpModal
          file={review.file}
          draft={review.draft}
          engine={review.engine}
          createdBy={profile.id}
          onClose={() => setReview(null)}
          onSaved={handleSaved}
        />
      ) : null}
      {saleRow && profile ? (
        <RecordSaleModal row={saleRow} recordedBy={profile.id} onClose={() => setSaleRow(null)} onSaved={handleSaved} />
      ) : null}
      {editRow ? (
        <EditLpItemModal row={editRow} onClose={() => setEditRow(null)} onSaved={handleSaved} />
      ) : null}
      {showPdfs ? <LpPdfsModal onClose={() => setShowPdfs(false)} /> : null}
    </div>
  );
}

export default function LpPage() {
  return (
    <RouteGuard requireCapability="lp_tracker">
      <AppShell>
        <LpContent />
      </AppShell>
    </RouteGuard>
  );
}
