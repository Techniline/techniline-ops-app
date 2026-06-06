"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode, WheelEvent } from "react";

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
  calculateCocobluSummary,
  createCocobluRecord,
  fetchCocobluAgeing,
  updateCocobluQty,
  type CocobluAgeingRow,
  type CocobluCreateInput,
} from "@/lib/cocoblu";

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
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
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

/* ------------------------------ Summary -------------------------------- */

function SummaryCards({ rows }: { rows: CocobluAgeingRow[] }) {
  const summary = useMemo(() => calculateCocobluSummary(rows), [rows]);

  const cards: ReadonlyArray<{ label: string; value: number; tone?: string }> =
    [
      { label: "Total Open Records", value: summary.totalOpenRecords },
      {
        label: "90+ Day Records",
        value: summary.over90Records,
        tone: "text-red-600 dark:text-red-400",
      },
      {
        label: "Warning Records",
        value: summary.warningRecords,
        tone: "text-orange-600 dark:text-orange-400",
      },
      { label: "Total Qty Remaining", value: summary.totalQtyRemaining },
      {
        label: "90+ Day Qty Remaining",
        value: summary.qty90Plus,
        tone: "text-red-600 dark:text-red-400",
      },
      { label: "76–89 Day Qty Remaining", value: summary.qty76To89 },
      { label: "61–75 Day Qty Remaining", value: summary.qty61To75 },
    ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={`${surface} p-4`}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {card.label}
          </p>
          <p
            className={`mt-1 text-2xl font-semibold ${
              card.tone ?? "text-slate-900 dark:text-slate-100"
            }`}
          >
            {card.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Table --------------------------------- */

const TH_CLASS =
  "whitespace-nowrap px-3 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400";
const TD_CLASS =
  "whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-300";

function AgeingTable({
  rows,
  onUpdate,
}: {
  rows: CocobluAgeingRow[];
  onUpdate: (row: CocobluAgeingRow) => void;
}) {
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
                {row.invoice_number ?? "—"}
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
                <button
                  type="button"
                  onClick={() => onUpdate(row)}
                  disabled={!row.id}
                  className={btnSmall}
                >
                  Update Qty
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Content -------------------------------- */

function CocobluContent() {
  const [rows, setRows] = useState<CocobluAgeingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [updateRow, setUpdateRow] = useState<CocobluAgeingRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCocobluAgeing();
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

  function handleSaved(message: string) {
    setShowAdd(false);
    setUpdateRow(null);
    setBanner(message);
    void load();
  }

  return (
    <div>
      <PageHeader
        title="Cocoblu Ageing"
        subtitle="Open stock records and ageing status."
        actions={
          <button
            type="button"
            onClick={() => {
              setBanner(null);
              setShowAdd(true);
            }}
            className={btnPrimary}
          >
            + Add Cocoblu Record
          </button>
        }
      />

      {banner ? (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span>{banner}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="ml-3 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>
          Loading Cocoblu ageing…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className={`${btnSecondary} mt-3`}
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500">
            No Cocoblu ageing records found.
          </p>
        </div>
      ) : (
        <>
          <SummaryCards rows={rows} />
          <AgeingTable rows={rows} onUpdate={(row) => setUpdateRow(row)} />
        </>
      )}

      {showAdd ? (
        <AddRecordModal onClose={() => setShowAdd(false)} onSaved={handleSaved} />
      ) : null}

      {updateRow ? (
        <UpdateQtyModal
          row={updateRow}
          onClose={() => setUpdateRow(null)}
          onSaved={handleSaved}
        />
      ) : null}
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
