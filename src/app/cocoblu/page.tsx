"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode, WheelEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import {
  btnPrimary,
  btnSecondary,
  btnSmall,
  inputClass,
  readonlyClass,
  surface,
} from "@/components/ui";
import {
  cocobluOverviewKpis,
  cocobluReport,
  createCocobluRecord,
  fetchCocobluInvoicesOverview,
  fetchCocobluLinesForInvoice,
  fetchCocobluWindow,
  fetchInvoiceAudit,
  invoicePdfUrl,
  listInvoicePdfs,
  parseInvoiceViaApi,
  saveVerifiedInvoice,
  updateCocobluQty,
  updateCocobluRecord,
  uploadInvoicePdf,
  type CaptureEngine,
  type CocobluAgeingRow,
  type CocobluCreateInput,
  type CocobluInvoiceOverviewRow,
  type InvoiceAudit,
  type InvoiceDraft,
  type StoredInvoice,
  type VerifiedLine,
} from "@/lib/cocoblu";
import {
  downloadCsv,
  printReportHtml,
  renderTableReportHtml,
  toCsv,
} from "@/lib/export";
import { isManager } from "@/lib/permissions";

/* ------------------------------- helpers ------------------------------- */

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function blurOnWheel(event: WheelEvent<HTMLInputElement>): void {
  event.currentTarget.blur();
}

function formatDate(value: string | null): string {
  return value ?? "—";
}

function formatNumber(value: number | null): string {
  return value == null ? "—" : value.toLocaleString();
}

function formatCost(value: number | null): string {
  return value == null
    ? "—"
    : value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

const AGEING_STYLES: Record<string, string> = {
  safe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  monitor:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  warning:
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  action_required: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function AgeingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const style =
    AGEING_STYLES[status] ??
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
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

/* ------------------------------ Add modal ------------------------------ */

interface AddFormState {
  invoice_number: string;
  invoice_date: string;
  supplied_date: string;
  sku: string;
  qty_supplied: string;
  qty_remaining: string;
  unit_cost: string;
  notes: string;
}

const EMPTY_ADD_FORM: AddFormState = {
  invoice_number: "",
  invoice_date: "",
  supplied_date: "",
  sku: "",
  qty_supplied: "",
  qty_remaining: "",
  unit_cost: "",
  notes: "",
};

function AddRecordModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<AddFormState>(EMPTY_ADD_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function update<K extends keyof AddFormState>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const required: ReadonlyArray<[keyof AddFormState, string]> = [
      ["invoice_number", "Invoice Number"],
      ["invoice_date", "Invoice Date"],
      ["supplied_date", "Supplied Date"],
      ["sku", "SKU"],
      ["qty_supplied", "Qty Supplied"],
      ["qty_remaining", "Qty Remaining"],
    ];
    for (const [key, label] of required) {
      if (form[key].trim() === "") {
        setFormError(`${label} is required.`);
        return;
      }
    }

    const qtySupplied = Number(form.qty_supplied);
    const qtyRemaining = Number(form.qty_remaining);
    if (!Number.isFinite(qtySupplied) || qtySupplied < 0) {
      setFormError("Qty Supplied must be a non-negative number.");
      return;
    }
    if (!Number.isFinite(qtyRemaining) || qtyRemaining < 0) {
      setFormError("Qty Remaining must be a non-negative number.");
      return;
    }

    let unitCost: number | null = null;
    if (form.unit_cost.trim() !== "") {
      const parsed = Number(form.unit_cost);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFormError("Unit Cost must be a non-negative number.");
        return;
      }
      unitCost = parsed;
    }

    const input: CocobluCreateInput = {
      invoice_number: form.invoice_number.trim(),
      invoice_date: form.invoice_date,
      supplied_date: form.supplied_date,
      sku: form.sku.trim(),
      qty_supplied: qtySupplied,
      qty_remaining: qtyRemaining,
      unit_cost: unitCost,
      notes: form.notes.trim() === "" ? null : form.notes.trim(),
    };

    setSaving(true);
    try {
      await createCocobluRecord(input);
      onSaved("Record added successfully.");
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Add Cocoblu Record" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormRow label="Invoice Number *">
            <input
              className={inputClass}
              value={form.invoice_number}
              onChange={(e) => update("invoice_number", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="SKU *">
            <input
              className={inputClass}
              value={form.sku}
              onChange={(e) => update("sku", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Invoice Date *">
            <input
              type="date"
              className={inputClass}
              value={form.invoice_date}
              onChange={(e) => update("invoice_date", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Supplied Date *">
            <input
              type="date"
              className={inputClass}
              value={form.supplied_date}
              onChange={(e) => update("supplied_date", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Qty Supplied *">
            <input
              type="number"
              min="0"
              step="1"
              onWheel={blurOnWheel}
              className={inputClass}
              value={form.qty_supplied}
              onChange={(e) => update("qty_supplied", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Qty Remaining *">
            <input
              type="number"
              min="0"
              step="1"
              onWheel={blurOnWheel}
              className={inputClass}
              value={form.qty_remaining}
              onChange={(e) => update("qty_remaining", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Unit Cost">
            <input
              type="number"
              min="0"
              step="0.01"
              onWheel={blurOnWheel}
              className={inputClass}
              value={form.unit_cost}
              onChange={(e) => update("unit_cost", e.target.value)}
            />
          </FormRow>
        </div>

        <FormRow label="Notes">
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </FormRow>

        {formError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ---------------------------- Update modal ----------------------------- */

function UpdateQtyModal({
  row,
  onClose,
  onSaved,
}: {
  row: CocobluAgeingRow;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [newQty, setNewQty] = useState("");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (newQty.trim() === "") {
      setFormError("New Qty Remaining is required.");
      return;
    }
    const parsed = Number(newQty);
    if (!Number.isFinite(parsed)) {
      setFormError("New Qty Remaining must be a number.");
      return;
    }
    if (!row.id) {
      setFormError("This record cannot be updated (missing id).");
      return;
    }

    setSaving(true);
    try {
      await updateCocobluQty({
        id: row.id,
        qtySupplied: row.qty_supplied ?? 0,
        newQtyRemaining: parsed,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      onSaved("Quantity updated successfully.");
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Update Qty" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormRow label="Invoice Number">
            <input
              className={readonlyClass}
              value={row.invoice_number ?? ""}
              readOnly
            />
          </FormRow>
          <FormRow label="SKU">
            <input className={readonlyClass} value={row.sku ?? ""} readOnly />
          </FormRow>
          <FormRow label="Qty Supplied">
            <input
              className={readonlyClass}
              value={formatNumber(row.qty_supplied)}
              readOnly
            />
          </FormRow>
          <FormRow label="Current Qty Remaining">
            <input
              className={readonlyClass}
              value={formatNumber(row.qty_remaining)}
              readOnly
            />
          </FormRow>
          <FormRow label="New Qty Remaining *">
            <input
              type="number"
              min="0"
              step="1"
              onWheel={blurOnWheel}
              className={inputClass}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              required
            />
          </FormRow>
        </div>

        <FormRow label="Notes">
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormRow>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60">
          Setting New Qty Remaining to 0 will close this record; it will then
          drop off this list (the view shows open records only).
        </p>

        {formError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* --------------------- Review / verify invoice modal ------------------- */

interface ReviewLine {
  sku: string;
  description: string;
  qty: string;
  unitCost: string;
}

function draftToLines(draft: InvoiceDraft): ReviewLine[] {
  return draft.lineItems.map((li) => ({
    sku: li.sku ?? "",
    description: li.description ?? "",
    qty: li.qty != null ? String(li.qty) : "",
    unitCost: li.unitCost != null ? String(li.unitCost) : "",
  }));
}

function ReviewInvoiceModal({
  file,
  draft,
  engine,
  verifiedById,
  onClose,
  onSaved,
}: {
  file: File;
  draft: InvoiceDraft;
  engine: CaptureEngine;
  verifiedById: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [invoiceNumber, setInvoiceNumber] = useState(draft.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(draft.invoiceDate ?? "");
  // These invoices carry a single date; default Supplied Date to the invoice
  // date (goods supplied on invoice) — still editable if delivery differs.
  const [suppliedDate, setSuppliedDate] = useState(
    draft.suppliedDate ?? draft.invoiceDate ?? ""
  );
  const [lines, setLines] = useState<ReviewLine[]>(draftToLines(draft));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function updateLine(index: number, key: keyof ReviewLine, value: string): void {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [key]: value } : l))
    );
  }
  function addLine(): void {
    setLines((prev) => [...prev, { sku: "", description: "", qty: "", unitCost: "" }]);
  }
  function removeLine(index: number): void {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    if (invoiceNumber.trim() === "") return setFormError("Invoice Number is required.");
    if (invoiceDate.trim() === "") return setFormError("Invoice Date is required.");
    if (lines.length === 0) return setFormError("Add at least one line item.");

    const verifiedLines: VerifiedLine[] = [];
    for (const [i, l] of lines.entries()) {
      if (l.sku.trim() === "") return setFormError(`Line ${i + 1}: SKU is required.`);
      const qty = Number(l.qty);
      if (l.qty.trim() === "" || !Number.isFinite(qty) || qty < 0) {
        return setFormError(`Line ${i + 1}: Qty must be a non-negative number.`);
      }
      let unitCost: number | null = null;
      if (l.unitCost.trim() !== "") {
        const parsed = Number(l.unitCost);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return setFormError(`Line ${i + 1}: Unit Cost must be a non-negative number.`);
        }
        unitCost = parsed;
      }
      verifiedLines.push({
        sku: l.sku.trim(),
        qtySupplied: qty,
        qtyRemaining: qty,
        unitCost,
        notes: l.description.trim() === "" ? null : l.description.trim(),
      });
    }

    setSaving(true);
    try {
      const pdfPath = await uploadInvoicePdf(file);
      const count = await saveVerifiedInvoice({
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        suppliedDate: suppliedDate.trim() === "" ? null : suppliedDate,
        pdfPath,
        verifiedBy: verifiedById,
        lineItems: verifiedLines,
      });
      onSaved(`Invoice saved — ${count} line item${count === 1 ? "" : "s"} recorded.`);
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Verify Invoice — auto-captured from PDF" onClose={onClose} wide>
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        {engine === "ai" ? "✨ AI-captured" : "Basic capture (free) — review line items carefully"} from{" "}
        <span className="font-medium">{file.name}</span>. Check every field, correct anything wrong,
        then save. Each line becomes one Cocoblu record.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Invoice details
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormRow label="Invoice Number *">
              <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
            </FormRow>
            <FormRow label="Invoice Date *">
              <input type="date" className={inputClass} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
            </FormRow>
            <FormRow label="Supplied Date">
              <input type="date" className={inputClass} value={suppliedDate} onChange={(e) => setSuppliedDate(e.target.value)} />
            </FormRow>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Line items ({lines.length})
            </p>
            <button type="button" onClick={addLine} className={btnSmall}>+ Add line</button>
          </div>
          <div className="flex flex-col gap-3">
            {lines.map((l, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/30"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Line {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-xs font-medium text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <label className="flex flex-col gap-1 text-sm sm:col-span-4">
                    <span className="font-medium text-slate-700 dark:text-slate-300">SKU *</span>
                    <input className={inputClass} value={l.sku} onChange={(e) => updateLine(i, "sku", e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm sm:col-span-4">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Description</span>
                    <input className={inputClass} value={l.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Qty *</span>
                    <input type="number" min="0" step="1" onWheel={blurOnWheel} className={inputClass} value={l.qty} onChange={(e) => updateLine(i, "qty", e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Unit Cost</span>
                    <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={l.unitCost} onChange={(e) => updateLine(i, "unitCost", e.target.value)} />
                  </label>
                </div>
              </div>
            ))}
            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
                No line items captured. Use “+ Add line” to enter them manually.
              </p>
            ) : null}
          </div>
        </div>

        {formError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{formError}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? "Saving…" : "Verify & Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ----------------------- Manager edit-record modal --------------------- */

function EditRecordModal({
  row,
  onClose,
  onSaved,
}: {
  row: CocobluAgeingRow;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    invoice_number: row.invoice_number ?? "",
    invoice_date: row.invoice_date ?? "",
    supplied_date: row.supplied_date ?? "",
    sku: row.sku ?? "",
    qty_supplied: row.qty_supplied != null ? String(row.qty_supplied) : "",
    qty_remaining: row.qty_remaining != null ? String(row.qty_remaining) : "",
    unit_cost: row.unit_cost != null ? String(row.unit_cost) : "",
    notes: row.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function update(key: keyof typeof form, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (!row.id) return setFormError("This record cannot be edited (missing id).");
    if (form.invoice_number.trim() === "") return setFormError("Invoice Number is required.");
    if (form.invoice_date.trim() === "") return setFormError("Invoice Date is required.");
    if (form.sku.trim() === "") return setFormError("SKU is required.");

    const qtySupplied = Number(form.qty_supplied);
    const qtyRemaining = Number(form.qty_remaining);
    if (!Number.isFinite(qtySupplied) || qtySupplied < 0) return setFormError("Qty Supplied must be a non-negative number.");
    if (!Number.isFinite(qtyRemaining) || qtyRemaining < 0) return setFormError("Qty Remaining must be a non-negative number.");
    if (qtyRemaining > qtySupplied) return setFormError("Qty Remaining cannot exceed Qty Supplied.");
    let unitCost: number | null = null;
    if (form.unit_cost.trim() !== "") {
      const parsed = Number(form.unit_cost);
      if (!Number.isFinite(parsed) || parsed < 0) return setFormError("Unit Cost must be a non-negative number.");
      unitCost = parsed;
    }

    setSaving(true);
    try {
      await updateCocobluRecord({
        id: row.id,
        invoiceNumber: form.invoice_number.trim(),
        invoiceDate: form.invoice_date,
        suppliedDate: form.supplied_date.trim() === "" ? null : form.supplied_date,
        sku: form.sku.trim(),
        qtySupplied,
        qtyRemaining,
        unitCost,
        notes: form.notes.trim() === "" ? null : form.notes.trim(),
      });
      onSaved("Record updated.");
    } catch (err) {
      setFormError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Edit Record (manager)" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormRow label="Invoice Number *">
            <input className={inputClass} value={form.invoice_number} onChange={(e) => update("invoice_number", e.target.value)} required />
          </FormRow>
          <FormRow label="SKU *">
            <input className={inputClass} value={form.sku} onChange={(e) => update("sku", e.target.value)} required />
          </FormRow>
          <FormRow label="Invoice Date *">
            <input type="date" className={inputClass} value={form.invoice_date} onChange={(e) => update("invoice_date", e.target.value)} required />
          </FormRow>
          <FormRow label="Supplied Date">
            <input type="date" className={inputClass} value={form.supplied_date} onChange={(e) => update("supplied_date", e.target.value)} />
          </FormRow>
          <FormRow label="Qty Supplied *">
            <input type="number" min="0" step="1" onWheel={blurOnWheel} className={inputClass} value={form.qty_supplied} onChange={(e) => update("qty_supplied", e.target.value)} required />
          </FormRow>
          <FormRow label="Qty Remaining *">
            <input type="number" min="0" step="1" onWheel={blurOnWheel} className={inputClass} value={form.qty_remaining} onChange={(e) => update("qty_remaining", e.target.value)} required />
          </FormRow>
          <FormRow label="Unit Cost">
            <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={form.unit_cost} onChange={(e) => update("unit_cost", e.target.value)} />
          </FormRow>
        </div>
        <FormRow label="Notes">
          <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
        </FormRow>

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

/* --------------------- Stored invoice PDFs browser --------------------- */

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function InvoicesModal({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<StoredInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listInvoicePdfs();
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
    const url = await invoicePdfUrl(path, download);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <ModalShell title="Stored Invoice PDFs" onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : err ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-slate-500">No invoice PDFs stored yet.</p>
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
                  <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300" title={f.name}>
                    {f.name}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {f.createdAt ? new Date(f.createdAt).toLocaleString() : "—"}
                  </td>
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

const TH_CLASS =
  "whitespace-nowrap px-3 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400";
const TD_CLASS =
  "whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-300";

function AgeingTable({
  rows,
  audit,
  managerFlag,
  onUpdate,
  onEdit,
}: {
  rows: CocobluAgeingRow[];
  audit: Map<string, InvoiceAudit>;
  managerFlag: boolean;
  onUpdate: (row: CocobluAgeingRow) => void;
  onEdit: (row: CocobluAgeingRow) => void;
}) {
  async function openPdf(path: string): Promise<void> {
    const url = await invoicePdfUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <div className={`${surface} overflow-x-auto`}>
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
          <tr>
            <th className={TH_CLASS}>Invoice Number</th>
            <th className={TH_CLASS}>Invoice Date</th>
            <th className={TH_CLASS}>Supplied Date</th>
            <th className={TH_CLASS}>SKU</th>
            <th className={TH_CLASS}>Qty Supplied</th>
            <th className={TH_CLASS}>Qty Remaining</th>
            <th className={TH_CLASS}>Unit Cost</th>
            <th className={TH_CLASS}>Ageing Days</th>
            <th className={TH_CLASS}>Ageing Status</th>
            <th className={TH_CLASS}>Notes</th>
            <th className={TH_CLASS}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id ?? `row-${index}`}
              className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30"
            >
              <td className={`${TD_CLASS} font-medium text-slate-900 dark:text-slate-100`}>
                <span className="inline-flex items-center gap-1.5">
                  {row.invoice_number ?? "—"}
                  {row.id && audit.get(row.id)?.pdfPath ? (
                    <button
                      type="button"
                      onClick={() => void openPdf(audit.get(row.id!)!.pdfPath!)}
                      className="text-indigo-500 hover:text-indigo-700"
                      title="View invoice PDF"
                      aria-label="View invoice PDF"
                    >
                      📎
                    </button>
                  ) : null}
                </span>
              </td>
              <td className={TD_CLASS}>{formatDate(row.invoice_date)}</td>
              <td className={TD_CLASS}>{formatDate(row.supplied_date)}</td>
              <td className={TD_CLASS}>{row.sku ?? "—"}</td>
              <td className={TD_CLASS}>{formatNumber(row.qty_supplied)}</td>
              <td className={TD_CLASS}>{formatNumber(row.qty_remaining)}</td>
              <td className={TD_CLASS}>{formatCost(row.unit_cost)}</td>
              <td className={TD_CLASS}>{formatNumber(row.ageing_days)}</td>
              <td className={TD_CLASS}>
                <AgeingBadge status={row.ageing_status} />
              </td>
              <td className={`${TD_CLASS} max-w-xs truncate`}>
                {row.notes ?? "—"}
              </td>
              <td className={TD_CLASS}>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdate(row)}
                    disabled={!row.id}
                    className={btnSmall}
                  >
                    Update Qty
                  </button>
                  {managerFlag ? (
                    <button
                      type="button"
                      onClick={() => onEdit(row)}
                      disabled={!row.id}
                      className={btnSmall}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------- Overview (by invoice) -------------------------- */

function OverviewKpiCards({ rows }: { rows: CocobluInvoiceOverviewRow[] }) {
  const k = useMemo(() => cocobluOverviewKpis(rows), [rows]);
  const cards: ReadonlyArray<{ label: string; value: string; tone?: string }> = [
    { label: "Open Invoices", value: k.openInvoices.toLocaleString() },
    { label: "Open Lines", value: k.openLines.toLocaleString() },
    { label: "Qty In Hand", value: k.totalRemainingQty.toLocaleString() },
    { label: "Value In Hand (AED)", value: formatCost(k.totalRemainingValue) },
    { label: "90+ Days (storage risk)", value: k.storageRisk90.toLocaleString(), tone: k.storageRisk90 > 0 ? "text-red-600 dark:text-red-400" : undefined },
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

function InvoiceRow({
  inv,
  managerFlag,
  onUpdate,
  onEdit,
}: {
  inv: CocobluInvoiceOverviewRow;
  managerFlag: boolean;
  onUpdate: (row: CocobluAgeingRow) => void;
  onEdit: (row: CocobluAgeingRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<CocobluAgeingRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const remaining = inv.total_remaining_qty ?? 0;

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next && lines === null && inv.invoice_number) {
      try {
        setLines(await fetchCocobluLinesForInvoice(inv.invoice_number));
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
        <span className="font-medium text-slate-900 dark:text-slate-100">{inv.invoice_number ?? "—"}</span>
        <span className="min-w-0 flex-1 text-xs text-slate-400">Inv {formatDate(inv.invoice_date)} · Supplied {formatDate(inv.supplied_date)}</span>
        <AgeingBadge status={inv.ageing_status} />
        <span className="text-xs text-slate-500">{formatNumber(inv.ageing_days)}d</span>
        <span className="text-sm text-slate-700 dark:text-slate-300">{formatNumber(remaining)} left · AED {formatCost(inv.total_remaining_value)}</span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-800/60 dark:bg-slate-800/20">
          {err ? (
            <p className="text-xs text-red-600">{err}</p>
          ) : lines === null ? (
            <p className="text-xs text-slate-400">Loading lines…</p>
          ) : (
            <AgeingTable rows={lines} audit={new Map()} managerFlag={managerFlag} onUpdate={onUpdate} onEdit={onEdit} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function CocobluOverviewSection({
  rows,
  managerFlag,
  onUpdate,
  onEdit,
}: {
  rows: CocobluInvoiceOverviewRow[];
  managerFlag: boolean;
  onUpdate: (row: CocobluAgeingRow) => void;
  onEdit: (row: CocobluAgeingRow) => void;
}) {
  return (
    <div>
      <OverviewKpiCards rows={rows} />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">No open Cocoblu stock. Use Upload Invoice or Add record.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((inv) => (
            <InvoiceRow key={inv.invoice_number} inv={inv} managerFlag={managerFlag} onUpdate={onUpdate} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Reports -------------------------------- */

function CocobluReportsModal({
  currentRows,
  onClose,
  onError,
}: {
  currentRows: CocobluAgeingRow[];
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const now = () => new Date().toLocaleString();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  function exportCurrent(format: "csv" | "pdf"): void {
    const table = cocobluReport(currentRows, now());
    if (format === "csv") downloadCsv("cocoblu-current", toCsv(table.headers, table.rows));
    else printReportHtml(table.title, renderTableReportHtml(table));
  }

  async function exportRange(format: "csv" | "pdf"): Promise<void> {
    setBusy(true);
    onError("");
    try {
      const rows = await fetchCocobluWindow({ fromIso: from, toIso: to, limit: 5000 });
      const table = cocobluReport(rows, now());
      if (format === "csv") downloadCsv("cocoblu-by-date", toCsv(table.headers, table.rows));
      else printReportHtml(table.title, renderTableReportHtml(table));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not build the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Reports & export" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="font-medium text-slate-900 dark:text-slate-100">Current view</p>
          <p className="mb-3 text-xs text-slate-500">Export the {currentRows.length} line{currentRows.length === 1 ? "" : "s"} currently loaded.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => exportCurrent("csv")} className={btnSmall}>CSV</button>
            <button type="button" onClick={() => exportCurrent("pdf")} className={btnSmall}>PDF</button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="font-medium text-slate-900 dark:text-slate-100">Invoice date range</p>
          <p className="mb-3 text-xs text-slate-500">All ageing lines whose invoice date falls in the range.</p>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormRow label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></FormRow>
            <FormRow label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></FormRow>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void exportRange("csv")} className={btnSmall}>CSV</button>
            <button type="button" disabled={busy} onClick={() => void exportRange("pdf")} className={btnSmall}>PDF</button>
            {busy ? <span className="text-xs text-slate-400">Building…</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------ Content -------------------------------- */

const COCOBLU_PAGE = 100;

type CocobluSection = "overview" | "browse";

function CocobluContent() {
  const { profile } = useAuth();
  const managerFlag = isManager(profile);

  const [section, setSection] = useState<CocobluSection>("overview");
  const [banner, setBanner] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // Overview (always on): per-invoice rollup.
  const [overview, setOverview] = useState<CocobluInvoiceOverviewRow[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Browse lines (on-demand windowed table).
  const [rows, setRows] = useState<CocobluAgeingRow[]>([]);
  const [audit, setAudit] = useState<Map<string, InvoiceAudit>>(new Map());
  const [linesLoaded, setLinesLoaded] = useState(false);
  const [linesLoading, setLinesLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  // Modals.
  const [showAdd, setShowAdd] = useState(false);
  const [updateRow, setUpdateRow] = useState<CocobluAgeingRow | null>(null);
  const [editRow, setEditRow] = useState<CocobluAgeingRow | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [review, setReview] = useState<{ file: File; draft: InvoiceDraft; engine: CaptureEngine } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      setOverview(await fetchCocobluInvoicesOverview());
    } catch (err) {
      setOverviewError(errorMessage(err));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function loadLines(): Promise<void> {
    setLinesLoading(true);
    setUploadError(null);
    try {
      const [data, auditMap] = await Promise.all([
        fetchCocobluWindow({ fromIso: dateFrom, toIso: dateTo, limit: COCOBLU_PAGE, offset: 0 }),
        fetchInvoiceAudit(),
      ]);
      setRows(data);
      setAudit(auditMap);
      setHasMore(data.length === COCOBLU_PAGE);
      setLinesLoaded(true);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setLinesLoading(false);
    }
  }

  function clearLines(): void {
    setRows([]);
    setLinesLoaded(false);
    setHasMore(false);
    setSearch("");
  }

  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      const data = await fetchCocobluWindow({ fromIso: dateFrom, toIso: dateTo, limit: COCOBLU_PAGE, offset: rows.length });
      setRows((prev) => [...prev, ...data]);
      setHasMore(data.length === COCOBLU_PAGE);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.invoice_number, r.sku, r.invoice_date].map((x) => (x ?? "").toLowerCase()).join(" ").includes(q)
    );
  }, [rows, search]);

  async function handleFileChosen(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setUploadError("Please choose a PDF invoice.");
      return;
    }
    setUploadError(null);
    setBanner(null);
    setParsing(true);
    try {
      const { draft, engine } = await parseInvoiceViaApi(file);
      setReview({ file, draft, engine });
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setParsing(false);
    }
  }

  function handleSaved(message: string) {
    setShowAdd(false);
    setUpdateRow(null);
    setEditRow(null);
    setReview(null);
    setBanner(message);
    void loadOverview();
    if (linesLoaded) void loadLines();
  }

  const navItem = (key: CocobluSection, label: string) => (
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
      <PageHeader title="Cocoblu Ageing" subtitle="Open stock by invoice — clear or return before 90 days to avoid storage charges." />

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
        <nav className={`flex shrink-0 flex-wrap gap-2 lg:sticky lg:top-0 lg:w-44 lg:flex-col lg:self-start ${surface} p-2`}>
          {navItem("overview", "Overview")}
          {navItem("browse", "Browse lines")}
          <button type="button" onClick={() => { setUploadError(null); fileInputRef.current?.click(); }} disabled={parsing} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800">
            {parsing ? "Reading…" : "Upload Invoice"}
          </button>
          <button type="button" onClick={() => { setBanner(null); setShowAdd(true); }} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Add record</button>
          <button type="button" onClick={() => setShowReports(true)} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Reports</button>
          <button type="button" onClick={() => setShowInvoices(true)} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Invoices</button>
        </nav>

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
              <CocobluOverviewSection rows={overview} managerFlag={managerFlag} onUpdate={(row) => setUpdateRow(row)} onEdit={(row) => setEditRow(row)} />
            )
          ) : (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                  <span className="text-xs font-medium uppercase tracking-wide">Invoice date</span>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
                  <span>→</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
                </div>
                <button type="button" onClick={() => void loadLines()} disabled={linesLoading} className={btnPrimary}>
                  {linesLoading ? "Loading…" : linesLoaded ? "Refresh" : "Load data"}
                </button>
                {linesLoaded ? <button type="button" onClick={clearLines} className={btnSecondary}>Clear</button> : null}
              </div>

              {!linesLoaded ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
                  <p className="text-sm text-slate-500">Pick an invoice-date range and click <span className="font-medium">Load data</span> to view line items.</p>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                      <input className={`${inputClass} pl-9`} placeholder="Search loaded lines by invoice, SKU, date…" value={search} onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} loaded{hasMore ? "+" : ""}
                      {hasMore ? " — load more or narrow the date range" : ""}
                    </p>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
                      <p className="text-sm text-slate-500">No loaded lines match your search.</p>
                    </div>
                  ) : (
                    <AgeingTable rows={filtered} audit={audit} managerFlag={managerFlag} onUpdate={(row) => setUpdateRow(row)} onEdit={(row) => setEditRow(row)} />
                  )}
                  {hasMore ? (
                    <div className="mt-4 flex justify-center">
                      <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={btnSecondary}>{loadingMore ? "Loading…" : `Load more (${COCOBLU_PAGE})`}</button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showAdd ? <AddRecordModal onClose={() => setShowAdd(false)} onSaved={handleSaved} /> : null}
      {updateRow ? <UpdateQtyModal row={updateRow} onClose={() => setUpdateRow(null)} onSaved={handleSaved} /> : null}
      {editRow ? <EditRecordModal row={editRow} onClose={() => setEditRow(null)} onSaved={handleSaved} /> : null}
      {review && profile ? (
        <ReviewInvoiceModal file={review.file} draft={review.draft} engine={review.engine} verifiedById={profile.id} onClose={() => setReview(null)} onSaved={handleSaved} />
      ) : null}
      {showInvoices ? <InvoicesModal onClose={() => setShowInvoices(false)} /> : null}
      {showReports ? <CocobluReportsModal currentRows={linesLoaded ? filtered : rows} onClose={() => setShowReports(false)} onError={(m) => setUploadError(m)} /> : null}
    </div>
  );
}

export default function CocobluPage() {
  return (
    <RouteGuard requireCapability="cocoblu">
      <AppShell>
        <CocobluContent />
      </AppShell>
    </RouteGuard>
  );
}
