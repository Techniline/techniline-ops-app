"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode, WheelEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { RouteGuard } from "@/components/RouteGuard";
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

/** Prevent scroll wheel from accidentally changing number inputs. */
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

const INPUT_CLASS =
  "rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:focus:border-gray-100";

const READONLY_CLASS =
  "rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400";

const AGEING_STYLES: Record<string, string> = {
  safe: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  monitor:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  warning:
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  action_required: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function AgeingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-gray-400">—</span>;
  const style =
    AGEING_STYLES[status] ??
    "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-gray-700 dark:text-gray-300">
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
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
              className={INPUT_CLASS}
              value={form.invoice_number}
              onChange={(e) => update("invoice_number", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="SKU *">
            <input
              className={INPUT_CLASS}
              value={form.sku}
              onChange={(e) => update("sku", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Invoice Date *">
            <input
              type="date"
              className={INPUT_CLASS}
              value={form.invoice_date}
              onChange={(e) => update("invoice_date", e.target.value)}
              required
            />
          </FormRow>
          <FormRow label="Supplied Date *">
            <input
              type="date"
              className={INPUT_CLASS}
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
              className={INPUT_CLASS}
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
              className={INPUT_CLASS}
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
              className={INPUT_CLASS}
              value={form.unit_cost}
              onChange={(e) => update("unit_cost", e.target.value)}
            />
          </FormRow>
        </div>

        <FormRow label="Notes">
          <textarea
            className={INPUT_CLASS}
            rows={2}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </FormRow>

        {formError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >
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
      // Validation (negative / exceeds supplied) is enforced by the data layer.
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
              className={READONLY_CLASS}
              value={row.invoice_number ?? ""}
              readOnly
            />
          </FormRow>
          <FormRow label="SKU">
            <input className={READONLY_CLASS} value={row.sku ?? ""} readOnly />
          </FormRow>
          <FormRow label="Qty Supplied">
            <input
              className={READONLY_CLASS}
              value={formatNumber(row.qty_supplied)}
              readOnly
            />
          </FormRow>
          <FormRow label="Current Qty Remaining">
            <input
              className={READONLY_CLASS}
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
              className={INPUT_CLASS}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              required
            />
          </FormRow>
        </div>

        <FormRow label="Notes">
          <textarea
            className={INPUT_CLASS}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormRow>

        <p className="text-xs text-gray-500">
          Setting New Qty Remaining to 0 will close this record; it will then
          drop off this list (the view shows open records only).
        </p>

        {formError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ------------------------------ Summary -------------------------------- */

function SummaryCards({
  rows,
}: {
  rows: CocobluAgeingRow[];
}) {
  const summary = useMemo(() => calculateCocobluSummary(rows), [rows]);

  const cards: ReadonlyArray<{ label: string; value: number }> = [
    { label: "Total Open Records", value: summary.totalOpenRecords },
    { label: "90+ Day Records", value: summary.over90Records },
    { label: "Warning Records", value: summary.warningRecords },
    { label: "Total Qty Remaining", value: summary.totalQtyRemaining },
    { label: "90+ Day Qty Remaining", value: summary.qty90Plus },
    { label: "76–89 Day Qty Remaining", value: summary.qty76To89 },
    { label: "61–75 Day Qty Remaining", value: summary.qty61To75 },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {card.label}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {card.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Table --------------------------------- */

const TH_CLASS =
  "whitespace-nowrap px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400";
const TD_CLASS = "whitespace-nowrap px-3 py-2 text-gray-700 dark:text-gray-300";

function AgeingTable({
  rows,
  onUpdate,
}: {
  rows: CocobluAgeingRow[];
  onUpdate: (row: CocobluAgeingRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="min-w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
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
              className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
            >
              <td className={TD_CLASS}>{row.invoice_number ?? "—"}</td>
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
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Cocoblu Ageing
        </h1>
        <button
          type="button"
          onClick={() => {
            setBanner(null);
            setShowAdd(true);
          }}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
        >
          Add Cocoblu Record
        </button>
      </div>

      {banner ? (
        <p className="mb-4 flex items-center justify-between rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          <span>{banner}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="ml-3 text-xs underline"
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading Cocoblu ageing…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm text-gray-500">No Cocoblu ageing records found.</p>
        </div>
      ) : (
        <>
          <SummaryCards rows={rows} />
          <AgeingTable rows={rows} onUpdate={(row) => setUpdateRow(row)} />
        </>
      )}

      {showAdd ? (
        <AddRecordModal
          onClose={() => setShowAdd(false)}
          onSaved={handleSaved}
        />
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
