"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode, WheelEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, btnSmall, inputClass, surface } from "@/components/ui";
import {
  downloadCsv,
  printReportHtml,
  renderTableReportHtml,
  renderTablesHtml,
  tablesToCsv,
  toCsv,
  type ReportTable,
} from "@/lib/export";
import { isManager } from "@/lib/permissions";
import {
  ENTITY_OPTIONS,
  computePriceAlerts,
  currentViewReport,
  entitySoldDetail,
  entitySoldTotals,
  fetchLpItemsWindow,
  fetchLpLinesForOrder,
  fetchLpOverview,
  fetchSaleHistory,
  fetchSalesReport,
  fetchVendors,
  listLpPdfs,
  lpPdfUrl,
  overviewKpis,
  parseLpViaApi,
  recordSale,
  saveVerifiedLp,
  setGoodsReceivedDate,
  stockInHandReport,
  updateLpItem,
  vendorReport,
  vendorRollup,
  type CaptureEngine,
  type EntityOption,
  type LpDraft,
  type LpItemRow,
  type LpOverviewRow,
  type LpStatusFilter,
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
  const [goodsReceived, setGoodsReceived] = useState(draft.lpDate ?? "");
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
        goodsReceivedDate: goodsReceived || lpDate,
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
            <FormRow label="Goods Received Date">
              <input type="date" className={inputClass} value={goodsReceived} onChange={(e) => setGoodsReceived(e.target.value)} />
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

interface ColFilters {
  vendor: string;
  brand: string;
  model: string;
}

function LpTable({
  rows,
  alerts,
  managerFlag,
  filters,
  onFilter,
  onSale,
  onEdit,
}: {
  rows: LpItemRow[];
  alerts: Map<string, PriceAlert>;
  managerFlag: boolean;
  filters: ColFilters;
  onFilter: (key: keyof ColFilters, value: string) => void;
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
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className="px-3 pb-2"></th>
            <th className="px-3 pb-2"></th>
            <th className="px-3 pb-2">
              <input
                value={filters.vendor}
                onChange={(e) => onFilter("vendor", e.target.value)}
                placeholder="Filter…"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-normal text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              />
            </th>
            <th className="px-3 pb-2">
              <input
                value={filters.model}
                onChange={(e) => onFilter("model", e.target.value)}
                placeholder="Filter…"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-normal text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              />
            </th>
            <th className="px-3 pb-2">
              <input
                value={filters.brand}
                onChange={(e) => onFilter("brand", e.target.value)}
                placeholder="Filter…"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-normal text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              />
            </th>
            <th className="px-3 pb-2" colSpan={8}></th>
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

/* ------------------------------ Reports -------------------------------- */

function exportReport(table: ReportTable, baseName: string, format: "csv" | "pdf"): void {
  if (format === "csv") {
    downloadCsv(baseName, toCsv(table.headers, table.rows));
  } else {
    printReportHtml(table.title, renderTableReportHtml(table));
  }
}

function ExportButtons({ onExport }: { onExport: (format: "csv" | "pdf") => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onExport("csv")} className={btnSmall}>CSV</button>
      <button type="button" onClick={() => onExport("pdf")} className={btnSmall}>PDF</button>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="font-medium text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      {children}
    </div>
  );
}

function ReportsModal({
  currentRows,
  onClose,
  onNotify,
  onError,
}: {
  currentRows: LpItemRow[];
  onClose: () => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
}) {
  const now = () => new Date().toLocaleString();
  const today = todayIso();

  const [vendors, setVendors] = useState<string[]>([]);
  const [vendor, setVendor] = useState("All");
  const [vFrom, setVFrom] = useState("");
  const [vTo, setVTo] = useState("");
  const [vendorBusy, setVendorBusy] = useState(false);

  const [entity, setEntity] = useState("All");
  const [eFrom, setEFrom] = useState("");
  const [eTo, setETo] = useState("");
  const [entityBusy, setEntityBusy] = useState(false);

  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await fetchVendors();
        if (active) setVendors(list);
      } catch {
        /* vendor dropdown is best-effort */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function exportCurrent(format: "csv" | "pdf"): void {
    exportReport(currentViewReport(currentRows, now()), `lp-current-${today}`, format);
  }

  async function exportVendor(format: "csv" | "pdf"): Promise<void> {
    setVendorBusy(true);
    onError("");
    try {
      // Fetch the full matching slice server-side (not just the loaded page).
      const rows = await fetchLpItemsWindow({ status: "all", vendor, fromIso: vFrom, toIso: vTo, limit: 5000 });
      exportReport(vendorReport(rows, vendor, vFrom, vTo, now()), `lp-vendor-${vendor === "All" ? "all" : vendor}-${today}`, format);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not build the vendor report.");
    } finally {
      setVendorBusy(false);
    }
  }

  async function exportEntity(format: "csv" | "pdf"): Promise<void> {
    setEntityBusy(true);
    onError("");
    try {
      const all = await fetchSalesReport(eFrom, eTo);
      const sales = entity === "All" ? all : all.filter((s) => s.entity === entity);
      const detail = entitySoldDetail(sales, now(), entity, eFrom, eTo);
      const totals = entitySoldTotals(sales);
      if (format === "csv") {
        downloadCsv(`lp-entity-sold-${entity === "All" ? "all" : entity}-${today}`, tablesToCsv([detail, totals]));
      } else {
        printReportHtml(detail.title, renderTablesHtml([detail, totals]));
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not build the entity report.");
    } finally {
      setEntityBusy(false);
    }
  }

  async function sendStockReport(): Promise<void> {
    setSending(true);
    onError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const openStock = await fetchLpItemsWindow({ status: "open", limit: 5000 });
      const table = stockInHandReport(openStock, now());
      const res = await fetch("/api/lp/send-report", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ["impex@techniline.org"],
          subject: `LP Stock in Hand — ${new Date().toLocaleDateString()}`,
          html: renderTableReportHtml(table),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) onNotify("Stock report emailed to impex@techniline.org.");
      else onError(`Could not send report: ${j.error ?? `HTTP ${res.status}`}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Email send failed.");
    } finally {
      setSending(false);
    }
  }

  const entityOptions = ["All", ...ENTITY_OPTIONS];

  return (
    <ModalShell title="Reports & export" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <Section title="Current view" hint={`Export the ${currentRows.length} line${currentRows.length === 1 ? "" : "s"} currently shown (your search + column filters apply).`}>
          <ExportButtons onExport={exportCurrent} />
        </Section>

        <Section title="Vendor & date range" hint="Lines filtered by vendor and LP (purchase) date — full purchased / sold / remaining / value / ageing status.">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormRow label="Vendor">
              <select className={inputClass} value={vendor} onChange={(e) => setVendor(e.target.value)}>
                <option value="All">All vendors</option>
                {vendors.map((v) => (<option key={v} value={v}>{v}</option>))}
              </select>
            </FormRow>
            <FormRow label="LP date from">
              <input type="date" className={inputClass} value={vFrom} onChange={(e) => setVFrom(e.target.value)} />
            </FormRow>
            <FormRow label="LP date to">
              <input type="date" className={inputClass} value={vTo} onChange={(e) => setVTo(e.target.value)} />
            </FormRow>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={vendorBusy} onClick={() => void exportVendor("csv")} className={btnSmall}>CSV</button>
            <button type="button" disabled={vendorBusy} onClick={() => void exportVendor("pdf")} className={btnSmall}>PDF</button>
            {vendorBusy ? <span className="text-xs text-slate-400">Building…</span> : null}
          </div>
        </Section>

        <Section title="Entity-wise sold" hint="Sales filtered by entity and sale date — detail rows plus totals per entity.">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormRow label="Entity">
              <select className={inputClass} value={entity} onChange={(e) => setEntity(e.target.value)}>
                {entityOptions.map((o) => (<option key={o} value={o}>{o === "All" ? "All entities" : o}</option>))}
              </select>
            </FormRow>
            <FormRow label="Sale date from">
              <input type="date" className={inputClass} value={eFrom} onChange={(e) => setEFrom(e.target.value)} />
            </FormRow>
            <FormRow label="Sale date to">
              <input type="date" className={inputClass} value={eTo} onChange={(e) => setETo(e.target.value)} />
            </FormRow>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={entityBusy} onClick={() => void exportEntity("csv")} className={btnSmall}>CSV</button>
            <button type="button" disabled={entityBusy} onClick={() => void exportEntity("pdf")} className={btnSmall}>PDF</button>
            {entityBusy ? <span className="text-xs text-slate-400">Building…</span> : null}
          </div>
        </Section>

        <Section title="Email stock-in-hand" hint="Send the current stock-in-hand snapshot to impex@techniline.org.">
          <button type="button" disabled={sending} onClick={() => void sendStockReport()} className={btnPrimary}>
            {sending ? "Sending…" : "Send to impex@"}
          </button>
        </Section>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
      </div>
    </ModalShell>
  );
}

/* --------------------- Goods Received Date modal ----------------------- */

function SetGrnModal({
  lp,
  onClose,
  onSaved,
}: {
  lp: LpOverviewRow;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [date, setDate] = useState(lp.goods_received_date ?? lp.lp_date ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErr(null);
    if (!lp.lp_id) return setErr("Missing LPO id.");
    setSaving(true);
    try {
      await setGoodsReceivedDate(lp.lp_id, date || null);
      onSaved("Goods Received Date updated.");
    } catch (e) {
      setErr(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Goods Received Date" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          {lp.lp_number} · {lp.vendor_name ?? "—"}. Ageing counts from this date (falls back to the LP date if cleared).
        </p>
        <FormRow label="Goods Received Date">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </FormRow>
        {err ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ---------------------- Overview (always-on rollup) -------------------- */

function OverviewKpiCards({ rows }: { rows: LpOverviewRow[] }) {
  const k = useMemo(() => overviewKpis(rows), [rows]);
  const cards: ReadonlyArray<{ label: string; value: string; tone?: string }> = [
    { label: "Open LPs", value: k.openLps.toLocaleString() },
    { label: "Open Lines", value: k.openLines.toLocaleString() },
    { label: "Qty In Hand", value: k.totalRemainingQty.toLocaleString() },
    { label: "Value In Hand (AED)", value: fmtCost(k.totalRemainingValue) },
    { label: "Aged 90+ LPs", value: k.aged90Lps.toLocaleString(), tone: k.aged90Lps > 0 ? "text-red-600 dark:text-red-400" : undefined },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className={`${surface} p-4`}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${c.tone ?? "text-slate-900 dark:text-slate-100"}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function LpoRow({
  lp,
  managerFlag,
  onSetGrn,
  onSale,
  onEdit,
}: {
  lp: LpOverviewRow;
  managerFlag: boolean;
  onSetGrn: (lp: LpOverviewRow) => void;
  onSale: (row: LpItemRow) => void;
  onEdit: (row: LpItemRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LpItemRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const remaining = lp.total_remaining_qty ?? 0;

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next && lines === null && lp.lp_id) {
      try {
        setLines(await fetchLpLinesForOrder(lp.lp_id));
      } catch (e) {
        setErr(errorMessage(e));
      }
    }
  }

  return (
    <div className={`${surface} overflow-hidden`}>
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
      >
        <span className="font-medium text-slate-900 dark:text-slate-100">{dash(lp.lp_number)}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-300" title={lp.vendor_name ?? ""}>{dash(lp.vendor_name)}</span>
        <span className="text-xs text-slate-400">LP {dash(lp.lp_date)} · GR {dash(lp.goods_received_date)}</span>
        <AgeingBadge status={lp.ageing_status} />
        <span className="text-xs text-slate-500">{fmtNum(lp.ageing_days)}d</span>
        <span className="text-sm text-slate-700 dark:text-slate-300">{fmtNum(remaining)} left · AED {fmtCost(lp.total_remaining_value)}</span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-800/60 dark:bg-slate-800/20">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lines ({lp.line_count ?? 0})</span>
            <button type="button" onClick={() => onSetGrn(lp)} className={btnSmall}>Set Goods Received Date</button>
          </div>
          {err ? (
            <p className="text-xs text-red-600">{err}</p>
          ) : lines === null ? (
            <p className="text-xs text-slate-400">Loading lines…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="py-1 pr-3">Model / SKU</th>
                    <th className="py-1 pr-3">Brand</th>
                    <th className="py-1 pr-3">Purch.</th>
                    <th className="py-1 pr-3">Sold</th>
                    <th className="py-1 pr-3">Remaining</th>
                    <th className="py-1 pr-3">Unit Price</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const rem = l.qty_remaining ?? 0;
                    return (
                      <tr key={l.id ?? i} className="border-t border-slate-100 dark:border-slate-800/60">
                        <td className="py-1.5 pr-3 text-slate-700 dark:text-slate-300">{dash(l.model_no ?? l.sku)}</td>
                        <td className="py-1.5 pr-3 text-slate-500">{dash(l.brand)}</td>
                        <td className="py-1.5 pr-3">{fmtNum(l.qty_purchased)}</td>
                        <td className="py-1.5 pr-3">{fmtNum(l.qty_sold)}</td>
                        <td className="py-1.5 pr-3 font-medium">{fmtNum(l.qty_remaining)}</td>
                        <td className="py-1.5 pr-3">{fmtCost(l.unit_price)}</td>
                        <td className="py-1.5">
                          <div className="flex gap-2">
                            <button type="button" disabled={!l.id || rem <= 0} onClick={() => onSale(l)} className={btnSmall}>Record sale</button>
                            {managerFlag ? (
                              <button type="button" disabled={!l.id} onClick={() => onEdit(l)} className={btnSmall}>Edit</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function OverviewSection({
  rows,
  managerFlag,
  onSetGrn,
  onSale,
  onEdit,
}: {
  rows: LpOverviewRow[];
  managerFlag: boolean;
  onSetGrn: (lp: LpOverviewRow) => void;
  onSale: (row: LpItemRow) => void;
  onEdit: (row: LpItemRow) => void;
}) {
  const [byVendor, setByVendor] = useState(false);
  const [openVendor, setOpenVendor] = useState<string | null>(null);
  const vendors = useMemo(() => vendorRollup(rows), [rows]);

  return (
    <div>
      <OverviewKpiCards rows={rows} />
      <div className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
        <button type="button" onClick={() => setByVendor(false)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${!byVendor ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>By LPO</button>
        <button type="button" onClick={() => setByVendor(true)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${byVendor ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>By Vendor</button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">No local purchases yet. Use Upload LP to add one.</p>
        </div>
      ) : byVendor ? (
        <div className="flex flex-col gap-2">
          {vendors.map((v) => (
            <div key={v.vendor} className={`${surface} overflow-hidden`}>
              <button
                type="button"
                onClick={() => setOpenVendor(openVendor === v.vendor ? null : v.vendor)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100">{v.vendor}</span>
                <span className="text-xs text-slate-500">{v.openLpCount}/{v.lpCount} open LPs</span>
                <span className="text-xs text-slate-500">oldest {v.oldestAgeingDays}d</span>
                <span className="text-sm text-slate-700 dark:text-slate-300">{v.totalRemainingQty.toLocaleString()} left · AED {fmtCost(v.totalRemainingValue)}</span>
                <span className="text-slate-400">{openVendor === v.vendor ? "▾" : "▸"}</span>
              </button>
              {openVendor === v.vendor ? (
                <div className="border-t border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800/60 dark:bg-slate-800/20">
                  <div className="flex flex-col gap-2">
                    {rows.filter((r) => (r.vendor_name ?? "—") === v.vendor).map((lp) => (
                      <LpoRow key={lp.lp_id} lp={lp} managerFlag={managerFlag} onSetGrn={onSetGrn} onSale={onSale} onEdit={onEdit} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((lp) => (
            <LpoRow key={lp.lp_id} lp={lp} managerFlag={managerFlag} onSetGrn={onSetGrn} onSale={onSale} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Content -------------------------------- */

const PAGE = 100;

type LpSection = "overview" | "browse";

function LpContent() {
  const { profile } = useAuth();
  const managerFlag = isManager(profile);

  const [section, setSection] = useState<LpSection>("overview");
  const [banner, setBanner] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // Overview (always on): the cheap per-LPO rollup.
  const [overview, setOverview] = useState<LpOverviewRow[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Browse lines (on-demand windowed table).
  const [allRows, setAllRows] = useState<LpItemRow[]>([]);
  const [linesLoaded, setLinesLoaded] = useState(false);
  const [linesLoading, setLinesLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [statusTab, setStatusTab] = useState<LpStatusFilter>("open");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColFilters>({ vendor: "", brand: "", model: "" });

  // Modals.
  const [saleRow, setSaleRow] = useState<LpItemRow | null>(null);
  const [editRow, setEditRow] = useState<LpItemRow | null>(null);
  const [grnLp, setGrnLp] = useState<LpOverviewRow | null>(null);
  const [showPdfs, setShowPdfs] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [review, setReview] = useState<{ file: File; draft: LpDraft; engine: CaptureEngine } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      setOverview(await fetchLpOverview());
    } catch (err) {
      setOverviewError(errorMessage(err));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Browse lines load only when the user asks (Load data).
  async function loadLines(): Promise<void> {
    setLinesLoading(true);
    setUploadError(null);
    try {
      const data = await fetchLpItemsWindow({ status: statusTab, fromIso: dateFrom, toIso: dateTo, limit: PAGE, offset: 0 });
      setAllRows(data);
      setHasMore(data.length === PAGE);
      setLinesLoaded(true);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setLinesLoading(false);
    }
  }

  function clearLines(): void {
    setAllRows([]);
    setLinesLoaded(false);
    setHasMore(false);
    setSearch("");
    setFilters({ vendor: "", brand: "", model: "" });
  }

  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      const data = await fetchLpItemsWindow({ status: statusTab, fromIso: dateFrom, toIso: dateTo, limit: PAGE, offset: allRows.length });
      setAllRows((prev) => [...prev, ...data]);
      setHasMore(data.length === PAGE);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const alerts = useMemo(() => computePriceAlerts(allRows), [allRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fv = filters.vendor.trim().toLowerCase();
    const fb = filters.brand.trim().toLowerCase();
    const fm = filters.model.trim().toLowerCase();
    const has = (hay: string | null, needle: string) => (hay ?? "").toLowerCase().includes(needle);
    return allRows.filter((r) => {
      if (q) {
        const blob = [r.lp_number, r.vendor_name, r.brand, r.lp_date, r.model_no, r.sku].map((x) => (x ?? "").toLowerCase()).join(" ");
        if (!blob.includes(q)) return false;
      }
      if (fv && !has(r.vendor_name, fv)) return false;
      if (fb && !has(r.brand, fb)) return false;
      if (fm && !(has(r.model_no, fm) || has(r.sku, fm))) return false;
      return true;
    });
  }, [allRows, search, filters]);

  function setFilter(key: keyof ColFilters, value: string): void {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

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
    setGrnLp(null);
    setReview(null);
    setBanner(message);
    void loadOverview();
    if (linesLoaded) void loadLines();
  }

  const filtersActive = search.trim() !== "" || filters.vendor !== "" || filters.brand !== "" || filters.model !== "";

  const navItem = (key: LpSection, label: string) => (
    <button
      type="button"
      onClick={() => setSection(key)}
      className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
        section === key
          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <PageHeader title="LP Tracker" subtitle="Local purchase stock — ageing, draw-down, and price alerts." />

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

      <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleFileChosen} />

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Left in-module nav */}
        <nav className={`flex shrink-0 flex-wrap gap-2 lg:w-44 lg:flex-col ${surface} p-2`}>
          {navItem("overview", "Overview")}
          {navItem("browse", "Browse lines")}
          <button type="button" onClick={() => { setUploadError(null); fileInputRef.current?.click(); }} disabled={parsing} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800">
            {parsing ? "Reading LP…" : "Upload LP"}
          </button>
          <button type="button" onClick={() => { setUploadError(null); setShowReports(true); }} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Reports</button>
          <button type="button" onClick={() => setShowPdfs(true)} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">LP PDFs</button>
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {section === "overview" ? (
            overviewLoading ? (
              <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading ageing overview…</div>
            ) : overviewError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
                <p className="text-sm text-red-700 dark:text-red-300">{overviewError}</p>
                <button type="button" onClick={() => void loadOverview()} className={`${btnSecondary} mt-3`}>Retry</button>
              </div>
            ) : (
              <OverviewSection
                rows={overview}
                managerFlag={managerFlag}
                onSetGrn={(lp) => setGrnLp(lp)}
                onSale={(row) => setSaleRow(row)}
                onEdit={(row) => setEditRow(row)}
              />
            )
          ) : (
            <div>
              {/* Browse controls */}
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
                  {(["open", "cleared", "all"] as LpStatusFilter[]).map((s) => (
                    <button key={s} type="button" onClick={() => setStatusTab(s)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${statusTab === s ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                      {s === "open" ? "In stock" : s === "cleared" ? "Cleared" : "All"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                  <span className="text-xs font-medium uppercase tracking-wide">LP date</span>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
                  <span>→</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
                </div>
                <button type="button" onClick={() => void loadLines()} disabled={linesLoading} className={btnPrimary}>
                  {linesLoading ? "Loading…" : linesLoaded ? "Refresh" : "Load data"}
                </button>
                {linesLoaded ? (
                  <button type="button" onClick={clearLines} className={btnSecondary}>Clear</button>
                ) : null}
              </div>

              {!linesLoaded ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
                  <p className="text-sm text-slate-500">Pick a status / date range and click <span className="font-medium">Load data</span> to view line items.</p>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                      <input className={`${inputClass} pl-9 pr-24`} placeholder="Search loaded lines by brand, vendor, LP number, date…" value={search} onChange={(e) => setSearch(e.target.value)} />
                      {filtersActive ? (
                        <button type="button" onClick={() => { setSearch(""); setFilters({ vendor: "", brand: "", model: "" }); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Clear all</button>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      Showing {filtered.length.toLocaleString()} of {allRows.length.toLocaleString()} loaded{hasMore ? "+" : ""}
                      {hasMore ? " — load more or narrow the date range" : ""}
                    </p>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
                      <p className="text-sm text-slate-500">No loaded lines match your search / filters.</p>
                    </div>
                  ) : (
                    <LpTable rows={filtered} alerts={alerts} managerFlag={managerFlag} filters={filters} onFilter={setFilter} onSale={(row) => setSaleRow(row)} onEdit={(row) => setEditRow(row)} />
                  )}
                  {hasMore ? (
                    <div className="mt-4 flex justify-center">
                      <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={btnSecondary}>{loadingMore ? "Loading…" : `Load more (${PAGE})`}</button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showReports ? (
        <ReportsModal
          currentRows={filtered}
          onClose={() => setShowReports(false)}
          onNotify={(m) => { setShowReports(false); setBanner(m); }}
          onError={(m) => setUploadError(m)}
        />
      ) : null}
      {review && profile ? (
        <VerifyLpModal file={review.file} draft={review.draft} engine={review.engine} createdBy={profile.id} onClose={() => setReview(null)} onSaved={handleSaved} />
      ) : null}
      {saleRow && profile ? (
        <RecordSaleModal row={saleRow} recordedBy={profile.id} onClose={() => setSaleRow(null)} onSaved={handleSaved} />
      ) : null}
      {editRow ? (
        <EditLpItemModal row={editRow} onClose={() => setEditRow(null)} onSaved={handleSaved} />
      ) : null}
      {grnLp ? (
        <SetGrnModal lp={grnLp} onClose={() => setGrnLp(null)} onSaved={handleSaved} />
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
