"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, WheelEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { SpapiConnectionCheck } from "@/components/SpapiConnectionCheck";
import {
  btnPrimary,
  btnSecondary,
  btnSmall,
  inputClass,
  surface,
  tableWrap,
  tdCell,
  thCell,
} from "@/components/ui";
import { formatAED, formatDate } from "@/lib/format";
import { normalizeRef } from "@/lib/finance/accuracy";
import {
  CATEGORY_LABELS,
  deriveConfidence,
  fetchAmazonActions,
  findOutcome,
  logAction,
  missingDocumentationQueue,
  operationalStatusLabel,
  OUTCOMES,
  searchAll,
  validateActionLog,
  type ActionCategory,
  type ActionEnrichment,
  type ActionLogInput,
  type AmazonAction,
  type ReferenceType,
  type SearchResult,
} from "@/lib/amazon-actions";
import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function blurOnWheel(event: WheelEvent<HTMLInputElement>): void {
  event.currentTarget.blur();
}

/* ------------------------------- badges -------------------------------- */

const SLA_STYLES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  escalated: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
};
function SlaBadge({ sla, ageDays }: { sla: string; ageDays: number }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SLA_STYLES[sla] ?? SLA_STYLES.green}`}>
      {sla} · {ageDays}d
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  action_required: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  waiting_amazon: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  closed: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};
function StatusBadge({ label, status }: { label: string; status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.closed}`}>
      {label}
    </span>
  );
}

const CONF_STYLES: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};
function ConfidenceBadge({ value }: { value: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${CONF_STYLES[value] ?? CONF_STYLES.low}`}>
      {value}
    </span>
  );
}

function referenceLabel(type: ReferenceType | undefined): string {
  switch (type) {
    case "srt": return "SRT Number";
    case "prt": return "PRT Number";
    case "dispute": return "Dispute ID";
    case "return": return "Return Reference";
    case "credit": return "Credit Reference";
    case "po_confirmation": return "PO Confirmation";
    case "qty": return "Quantity";
    default: return "Reference";
  }
}

/* --------------------- categories & cross-links ------------------------ */

/**
 * UI filters. `cancellation` is a display-only split of the `po` category
 * (rawType `po_cancellation`) — the persisted action_type stays within the
 * existing five categories, so nothing in the write/closure path changes.
 */
type UiFilter = ActionCategory | "all" | "cancellation";

const CATEGORY_TABS: ReadonlyArray<{ key: UiFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "po", label: "PO Confirmation" },
  { key: "cancellation", label: "Cancellations" },
  { key: "dispute", label: "Disputes" },
  { key: "shortage", label: "Shortage" },
  { key: "remittance", label: "Remittance" },
];

/** Is this action a PO cancellation (vs a PO confirmation)? */
function isCancellation(a: AmazonAction): boolean {
  return a.rawType === "po_cancellation";
}

/** Display label that distinguishes cancellations from PO confirmations. */
function displayCategoryLabel(a: AmazonAction): string {
  if (isCancellation(a)) return "PO Cancellation";
  return CATEGORY_LABELS[a.category];
}

/** Does the action match the selected UI filter tab? */
function matchesFilter(a: AmazonAction, filter: UiFilter): boolean {
  if (filter === "all") return true;
  if (filter === "cancellation") return isCancellation(a);
  if (filter === "po") return a.category === "po" && !isCancellation(a);
  return a.category === filter;
}

/** Normalized reference keys an action can be linked to other records by. */
function actionKeys(a: AmazonAction): string[] {
  const raw = [
    a.amazonRef,
    a.invoiceRef,
    a.referenceValue,
    a.enrichment.returnId,
    a.enrichment.srtNumber,
    a.enrichment.prtNumber,
    a.enrichment.paymentNumber,
    a.enrichment.tleInvoiceNumber,
  ];
  return Array.from(
    new Set(
      raw
        .filter((v): v is string => !!v && v.trim() !== "")
        .map((v) => normalizeRef(v))
        .filter((k) => k.length >= 3)
    )
  );
}

/** Other actions that share a reference with this one (cancellation↔PO, return↔dispute…). */
function relatedActions(a: AmazonAction, all: AmazonAction[]): AmazonAction[] {
  const keys = new Set(actionKeys(a));
  if (keys.size === 0) return [];
  return all.filter((b) => b.id !== a.id && actionKeys(b).some((k) => keys.has(k)));
}

/* ----------------------- inline detail panel --------------------------- */

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-sm text-slate-800 dark:text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>
        {value && value.trim() !== "" ? value : "—"}
      </dd>
    </div>
  );
}

/** Expanded, read-only detail for a row, with cross-links and a "log/update" action. */
function ActionDetail({
  action,
  all,
  onOpenLink,
  onLog,
}: {
  action: AmazonAction;
  all: AmazonAction[];
  onOpenLink: (id: string) => void;
  onLog: (a: AmazonAction) => void;
}) {
  const e = action.enrichment;
  const related = relatedActions(action, all);
  const statusLabel = operationalStatusLabel({
    category: action.category,
    latestOutcome: action.latestOutcome,
    workflowStatus: action.workflowStatus,
    resolved: action.resolved,
  });

  return (
    <div className="border-t border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <DetailRow label="Category" value={displayCategoryLabel(action)} />
        <DetailRow label="Status" value={statusLabel} />
        <DetailRow label="Latest outcome" value={action.latestOutcome ? action.latestOutcome.replace(/_/g, " ") : null} />
        <DetailRow label="SLA" value={`${action.sla} · ${action.ageDays}d`} />
        <DetailRow label="Amazon Ref / PO" value={action.amazonRef} mono />
        <DetailRow label="Invoice Ref" value={action.invoiceRef} mono />
        <DetailRow label="Received" value={`${formatDate(action.emailReceivedAt)}`} />
        <DetailRow label="Follow-up / ETA" value={action.followUpDate ? formatDate(action.followUpDate) : null} />
        <DetailRow label="Reference" value={action.referenceValue} mono />
        <DetailRow label="Return ID" value={e.returnId} mono />
        <DetailRow label="SRT Number" value={e.srtNumber} mono />
        <DetailRow label="PRT Number" value={e.prtNumber} mono />
        <DetailRow label="Dispute / Payment #" value={e.paymentNumber} mono />
        <DetailRow label="TLE Invoice" value={e.tleInvoiceNumber} mono />
        <DetailRow label="SKU" value={e.sku} mono />
        <DetailRow label="Invoice value" value={e.invoiceValueAed != null ? formatAED(e.invoiceValueAed) : null} />
        <DetailRow label="Action value" value={action.amount != null ? formatAED(action.amount) : null} />
        <DetailRow label="Recovered" value={action.recovered != null ? formatAED(action.recovered) : null} />
        <DetailRow label="Approved amount" value={e.approvedAmountAed != null ? formatAED(e.approvedAmountAed) : null} />
        <DetailRow label="Confidence" value={action.confidence} />
      </div>

      {action.emailSubject ? (
        <div className="mt-3">
          <dt className="text-xs text-slate-500">Email subject</dt>
          <dd className="text-sm text-slate-800 dark:text-slate-200">{action.emailSubject}</dd>
        </div>
      ) : null}

      <div className="mt-3">
        <dt className="text-xs text-slate-500">Staff remarks / reason</dt>
        <dd className="text-sm text-slate-800 dark:text-slate-200">
          {action.reasonNote && action.reasonNote.trim() !== "" ? action.reasonNote : "—"}
        </dd>
      </div>

      {/* Cross-linked records (same PO / dispute / return / invoice reference). */}
      {related.length > 0 ? (
        <div className="mt-4">
          <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Linked records</dt>
          <div className="flex flex-wrap gap-1.5">
            {related.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenLink(r.id)}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300"
                title={r.emailSubject ?? undefined}
              >
                <span className="font-semibold">{displayCategoryLabel(r)}</span>
                <span className="font-mono opacity-80">{r.amazonRef ?? r.referenceValue ?? r.id.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => onLog(action)} className={btnSmall}>
          {action.missingDocumentation ? "Add missing details" : action.resolved ? "Update action" : "Log action"}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- action modal ---------------------------- */

function LogActionModal({
  action,
  profile,
  managerFlag,
  usedRefs,
  onClose,
  onSaved,
}: {
  action: AmazonAction;
  profile: UserProfile;
  managerFlag: boolean;
  usedRefs: Set<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const category: ActionCategory = action.category;
  const options = OUTCOMES[category].filter((o) => !o.managerOnly || managerFlag);

  const [outcome, setOutcome] = useState("");
  const [referenceValue, setReferenceValue] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [amount, setAmount] = useState(action.amount != null ? String(action.amount) : "");
  const [recovered, setRecovered] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enr, setEnr] = useState({
    tleInvoiceNumber: action.enrichment.tleInvoiceNumber ?? "",
    paymentNumber: action.enrichment.paymentNumber ?? "",
    returnId: action.enrichment.returnId ?? "",
    srtNumber: action.enrichment.srtNumber ?? "",
    prtNumber: action.enrichment.prtNumber ?? "",
    invoiceDate: action.enrichment.invoiceDate ?? "",
    invoiceValueAed:
      action.enrichment.invoiceValueAed != null ? String(action.enrichment.invoiceValueAed) : "",
    sku: action.enrichment.sku ?? "",
    approvedAmountAed:
      action.enrichment.approvedAmountAed != null ? String(action.enrichment.approvedAmountAed) : "",
    notes: action.enrichment.notes ?? "",
  });
  const [showEnrichment, setShowEnrichment] = useState(
    category === "dispute" || category === "return"
  );

  function setEnrField(key: keyof typeof enr, value: string): void {
    setEnr((prev) => ({ ...prev, [key]: value }));
  }

  const option = outcome ? findOutcome(category, outcome) : undefined;
  const requires = option?.requires;

  const showReference = requires === "reference";
  const showQtyReason = requires === "qty_and_reason";
  const showReason = requires === "reason" || requires === "note";
  const showEta = requires === "eta";
  const showRecovered = requires === "recovered" || requires === "recovered_and_note";
  const showRecoveredNote = requires === "recovered_and_note";
  const showOptionalNote = requires === "none";

  const dupWarning =
    (showReference || showQtyReason) &&
    referenceValue.trim() !== "" &&
    usedRefs.has(normalizeRef(referenceValue));

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!option) {
      setError("Please choose an outcome.");
      return;
    }

    const usesRef = showReference || showQtyReason;
    const amountNum = amount.trim() === "" ? null : Number(amount);
    if (amountNum != null && (!Number.isFinite(amountNum) || amountNum < 0)) {
      setError("Action value must be a non-negative number.");
      return;
    }
    const recoveredNum = recovered.trim() === "" ? null : Number(recovered);
    if (recoveredNum != null && (!Number.isFinite(recoveredNum) || recoveredNum < 0)) {
      setError("Recovered amount must be a non-negative number.");
      return;
    }

    const resolved =
      option.workflowStatus === "resolved" || option.workflowStatus === "closed";
    const refValue = usesRef ? referenceValue.trim() : null;

    const invoiceValueNum =
      enr.invoiceValueAed.trim() === "" ? null : Number(enr.invoiceValueAed);
    if (invoiceValueNum != null && (!Number.isFinite(invoiceValueNum) || invoiceValueNum < 0)) {
      setError("Invoice value must be a non-negative number.");
      return;
    }
    const approvedNum =
      enr.approvedAmountAed.trim() === "" ? null : Number(enr.approvedAmountAed);
    if (approvedNum != null && (!Number.isFinite(approvedNum) || approvedNum < 0)) {
      setError("Approved amount must be a non-negative number.");
      return;
    }

    const enrichment: ActionEnrichment = {
      tleInvoiceNumber: enr.tleInvoiceNumber.trim() || null,
      paymentNumber: enr.paymentNumber.trim() || null,
      returnId: enr.returnId.trim() || null,
      srtNumber: enr.srtNumber.trim() || null,
      prtNumber: enr.prtNumber.trim() || null,
      invoiceDate: enr.invoiceDate || null,
      invoiceValueAed: invoiceValueNum,
      sku: enr.sku.trim() || null,
      approvedAmountAed: approvedNum,
      notes: enr.notes.trim() || null,
    };

    const input: ActionLogInput = {
      expectedActionId: action.id,
      actionType: category,
      outcome,
      referenceValue: refValue || null,
      reasonNote: reasonNote.trim() || null,
      followUpDate: followUpDate || null,
      amountAed: amountNum,
      recoveredAed: showRecovered ? recoveredNum : null,
      confidence: deriveConfidence({
        invoiceLinked: false,
        hasReference: !!refValue,
        hasAmount: amountNum != null,
        resolved,
      }),
      duplicateWarning: dupWarning,
      createdBy: profile.id,
      isManager: managerFlag,
      enrichment,
    };

    const validation = validateActionLog(input);
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    try {
      await logAction(input);
      onSaved("Action logged.");
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={`${CATEGORY_LABELS[category]} — log action`} onClose={onClose}>
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><dt className="text-slate-500">Amazon Ref</dt><dd className="font-mono text-xs">{action.amazonRef ?? "—"}</dd></div>
        <div><dt className="text-slate-500">Received</dt><dd>{formatDate(action.emailReceivedAt)} ({action.ageDays}d)</dd></div>
        {action.emailSubject ? (
          <div className="col-span-2"><dt className="text-slate-500">Subject</dt><dd className="truncate">{action.emailSubject}</dd></div>
        ) : null}
      </dl>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Outcome *</span>
          <select
            className={inputClass}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            required
          >
            <option value="">Select outcome…</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>

        {showReference || showQtyReason ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {referenceLabel(option?.referenceType)} *
            </span>
            <input
              className={inputClass}
              value={referenceValue}
              onChange={(e) => setReferenceValue(e.target.value)}
              inputMode={showQtyReason ? "numeric" : "text"}
            />
            {dupWarning ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ This reference is already used on another action (not blocked).
              </span>
            ) : null}
          </label>
        ) : null}

        {showEta ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">ETA *</span>
            <input type="date" className={inputClass} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </label>
        ) : null}

        {showRecovered ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Recovered amount (AED) *</span>
            <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={recovered} onChange={(e) => setRecovered(e.target.value)} />
          </label>
        ) : null}

        {showReason || showQtyReason || showRecoveredNote ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {showReason ? "Note / reason *" : "Reason *"}
            </span>
            <textarea className={inputClass} rows={2} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
          </label>
        ) : null}

        {showOptionalNote ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Note (optional)</span>
            <textarea className={inputClass} rows={2} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
          </label>
        ) : null}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Action value / exposure (AED)</span>
          <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Optional — enter if invoice amount unavailable" />
        </label>

        {/* Manual enrichment (optional) */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowEnrichment((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Enrichment (optional)
            <span className="text-slate-400">{showEnrichment ? "−" : "+"}</span>
          </button>
          {showEnrichment ? (
            <div className="grid grid-cols-1 gap-3 border-t border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-800">
              {[
                ["tleInvoiceNumber", "TLE Invoice"],
                ["paymentNumber", "Payment Number"],
                ["returnId", "Return ID"],
                ["srtNumber", "SRT Number"],
                ["prtNumber", "PRT Number"],
                ["sku", "SKU"],
              ].map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-slate-600 dark:text-slate-400">{label}</span>
                  <input
                    className={inputClass}
                    value={enr[key as keyof typeof enr]}
                    onChange={(e) => setEnrField(key as keyof typeof enr, e.target.value)}
                  />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-400">Invoice Date</span>
                <input type="date" className={inputClass} value={enr.invoiceDate} onChange={(e) => setEnrField("invoiceDate", e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-400">Invoice Value (AED)</span>
                <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={enr.invoiceValueAed} onChange={(e) => setEnrField("invoiceValueAed", e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-400">Approved Amount (AED)</span>
                <input type="number" min="0" step="0.01" onWheel={blurOnWheel} className={inputClass} value={enr.approvedAmountAed} onChange={(e) => setEnrField("approvedAmountAed", e.target.value)} />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="font-medium text-slate-600 dark:text-slate-400">Notes</span>
                <textarea rows={2} className={inputClass} value={enr.notes} onChange={(e) => setEnrField("notes", e.target.value)} />
              </label>
            </div>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save action"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------- advanced search --------------------------- */

function AdvancedSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setErr(null);
    setSearched(true);
    try {
      setResults(await searchAll(q));
    } catch (e) {
      setErr(errorMessage(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className={`${surface} mb-6 p-3`}>
      <form onSubmit={run} className="flex gap-2">
        <input
          className={inputClass}
          placeholder="Search dispute #, payment #, return ID, SRT, PRT, invoice #, PO #, SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className={btnPrimary} disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {err ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{err}</p> : null}
      {searched && !searching && !err && results.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No matches found.</p>
      ) : null}
      {results.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className={thCell}>Type</th>
                <th className={thCell}>Reference</th>
                <th className={thCell}>Detail</th>
                <th className={thCell}>Amount</th>
                <th className={thCell}>Matched on</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.sourceTable}-${r.id}-${i}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <td className={tdCell}>{r.category}</td>
                  <td className={`${tdCell} font-mono text-xs`}>{r.primaryLabel ?? "—"}</td>
                  <td className={`${tdCell} max-w-xs truncate`}>{r.secondaryLabel ?? "—"}</td>
                  <td className={tdCell}>{formatAED(r.amount)}</td>
                  <td className={tdCell}>{r.matchedField ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- content ------------------------------- */

function AmazonActionsContent() {
  const { profile } = useAuth();

  const [actions, setActions] = useState<AmazonAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [selected, setSelected] = useState<AmazonAction | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<UiFilter>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAmazonActions();
      setActions(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Sort by received date — newest first by default, toggleable to oldest. */
  const byDate = useCallback(
    (a: AmazonAction, b: AmazonAction) => {
      const ta = Date.parse(a.emailReceivedAt) || 0;
      const tb = Date.parse(b.emailReceivedAt) || 0;
      return sortOrder === "newest" ? tb - ta : ta - tb;
    },
    [sortOrder]
  );

  const usedRefs = useMemo(() => {
    const set = new Set<string>();
    for (const a of actions) {
      if (a.referenceValue) set.add(normalizeRef(a.referenceValue));
    }
    return set;
  }, [actions]);

  const list = useMemo(() => {
    let rows = showResolved ? actions : actions.filter((a) => !a.resolved);
    rows = rows.filter((a) => matchesFilter(a, categoryFilter));
    return [...rows].sort(byDate);
  }, [actions, showResolved, categoryFilter, byDate]);

  const queue = useMemo(() => {
    const base = missingDocumentationQueue(actions).filter((a) =>
      matchesFilter(a, categoryFilter)
    );
    return [...base].sort(byDate);
  }, [actions, categoryFilter, byDate]);

  /** Open a linked record: select its tab if needed, expand it, scroll to it. */
  const openLinked = useCallback(
    (id: string) => {
      const target = actions.find((a) => a.id === id);
      if (target && !matchesFilter(target, categoryFilter)) {
        setCategoryFilter("all");
      }
      if (target && target.resolved && !showResolved) setShowResolved(true);
      setExpandedId(id);
      // Scroll the row into view after it renders.
      setTimeout(() => {
        document.getElementById(`action-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    },
    [actions, categoryFilter, showResolved]
  );

  if (!profile) return null;
  const managerFlag = isManager(profile);

  function handleSaved(message: string) {
    setSelected(null);
    setBanner(message);
    void load();
  }

  return (
    <div>
      <PageHeader
        title="Amazon Actions"
        subtitle="Drive Amazon issues to closure — log a reference or reason for each."
      />

      {isManager(profile) ? <SpapiConnectionCheck /> : null}

      <div className="sticky top-24 z-10 -mx-4 mb-4 bg-slate-50/95 px-4 pb-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:bg-slate-950/95">
        <AdvancedSearch />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_TABS.map((tab) => {
              const active = categoryFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setCategoryFilter(tab.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Sort</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {(CATEGORY_TABS.find((t) => t.key === categoryFilter)?.label ?? "All")} ({list.length})
          </h2>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        </div>
      </div>

      {banner ? (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
      ) : null}

      {loading ? (
        <div className={`${surface} p-8 text-center text-sm text-slate-500`}>Loading actions…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button type="button" onClick={() => void load()} className={`${btnSecondary} mt-3`}>Retry</button>
        </div>
      ) : (
        <>
          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <p className="text-sm text-slate-500">No actions to show.</p>
            </div>
          ) : (
            <div className={`${tableWrap} max-h-[calc(100dvh-20rem)] overflow-auto`}>
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
                  <tr>
                    <th className={thCell}>Category</th>
                    <th className={thCell}>Amazon Ref</th>
                    <th className={thCell}>Received</th>
                    <th className={thCell}>SLA</th>
                    <th className={thCell}>Status</th>
                    <th className={thCell}>Outcome</th>
                    <th className={thCell}>Reference</th>
                    <th className={thCell}>Amount</th>
                    <th className={thCell}>Confidence</th>
                    <th className={thCell}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const open = expandedId === a.id;
                    return (
                      <Fragment key={a.id}>
                        <tr
                          id={`action-${a.id}`}
                          onClick={() => setExpandedId(open ? null : a.id)}
                          className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30 ${open ? "bg-slate-50 dark:bg-slate-800/30" : ""}`}
                        >
                          <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>
                            <span className="mr-1.5 inline-block text-slate-400">{open ? "▾" : "▸"}</span>
                            {displayCategoryLabel(a)}
                          </td>
                          <td className={`${tdCell} font-mono text-xs`}>{a.amazonRef ?? "—"}</td>
                          <td className={`${tdCell} whitespace-nowrap text-xs text-slate-500`}>{formatDate(a.emailReceivedAt)}</td>
                          <td className={tdCell}><SlaBadge sla={a.sla} ageDays={a.ageDays} /></td>
                          <td className={tdCell}>
                            <StatusBadge
                              label={operationalStatusLabel({
                                category: a.category,
                                latestOutcome: a.latestOutcome,
                                workflowStatus: a.workflowStatus,
                                resolved: a.resolved,
                              })}
                              status={a.workflowStatus}
                            />
                          </td>
                          <td className={tdCell}>{a.latestOutcome ? a.latestOutcome.replace(/_/g, " ") : "—"}</td>
                          <td className={`${tdCell} font-mono text-xs`}>{a.referenceValue ?? "—"}</td>
                          <td className={tdCell}>{formatAED(a.amount)}</td>
                          <td className={tdCell}><ConfidenceBadge value={a.confidence} /></td>
                          <td className={tdCell}>
                            <button
                              type="button"
                              onClick={(ev) => { ev.stopPropagation(); setSelected(a); }}
                              className={btnSmall}
                            >
                              {a.resolved ? "Update" : "Log action"}
                            </button>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                            <td colSpan={10} className="p-0">
                              <ActionDetail
                                action={a}
                                all={actions}
                                onOpenLink={openLinked}
                                onLog={(x) => setSelected(x)}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Missing Documentation — priority subset (matches the filter above) */}
          <section className="mt-8">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Missing Documentation
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                {queue.length}
              </span>
            </h2>
            {queue.length === 0 ? (
              <div className={`${surface} p-6 text-center text-sm text-slate-500`}>
                Nothing outstanding for this filter. 🎉
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {queue.map((a) => (
                  <li key={a.id} className={`${surface} flex flex-wrap items-center justify-between gap-3 p-3`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{displayCategoryLabel(a)}</span>
                        <SlaBadge sla={a.sla} ageDays={a.ageDays} />
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">{a.missingKind}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        <span className="font-medium text-slate-600 dark:text-slate-400">{formatDate(a.emailReceivedAt)}</span>
                        {" · "}
                        <span className="font-mono">{a.amazonRef ?? "—"}</span>
                        {a.emailSubject ? ` · ${a.emailSubject}` : ""}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSelected(a)} className={btnPrimary}>Log action</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {selected ? (
        <LogActionModal
          action={selected}
          profile={profile}
          managerFlag={managerFlag}
          usedRefs={usedRefs}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

export default function AmazonActionsPage() {
  return (
    <RouteGuard requireCapability="finance">
      <AppShell>
        <AmazonActionsContent />
      </AppShell>
    </RouteGuard>
  );
}
