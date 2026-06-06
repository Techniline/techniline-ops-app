"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, WheelEvent } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
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
  OUTCOMES,
  validateActionLog,
  type ActionCategory,
  type ActionLogInput,
  type AmazonAction,
  type ReferenceType,
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
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.closed}`}>
      {status.replace(/_/g, " ")}
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

/* ------------------------------- content ------------------------------- */

function AmazonActionsContent() {
  const { profile } = useAuth();

  const [actions, setActions] = useState<AmazonAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [selected, setSelected] = useState<AmazonAction | null>(null);
  const [showResolved, setShowResolved] = useState(false);

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

  const queue = useMemo(() => missingDocumentationQueue(actions), [actions]);
  const usedRefs = useMemo(() => {
    const set = new Set<string>();
    for (const a of actions) {
      if (a.referenceValue) set.add(normalizeRef(a.referenceValue));
    }
    return set;
  }, [actions]);

  const list = useMemo(() => {
    const rows = showResolved ? actions : actions.filter((a) => !a.resolved);
    return [...rows].sort((a, b) => b.ageDays - a.ageDays);
  }, [actions, showResolved]);

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
          {/* Missing Documentation queue — the priority section */}
          <section className="mb-8">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Missing Documentation
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                {queue.length}
              </span>
            </h2>
            {queue.length === 0 ? (
              <div className={`${surface} p-6 text-center text-sm text-slate-500`}>
                Nothing outstanding — all actions are documented. 🎉
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {queue.map((a) => (
                  <li key={a.id} className={`${surface} flex flex-wrap items-center justify-between gap-3 p-3`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{CATEGORY_LABELS[a.category]}</span>
                        <SlaBadge sla={a.sla} ageDays={a.ageDays} />
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">{a.missingKind}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
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

          {/* Full actions list */}
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">All Actions ({list.length})</h2>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              Show resolved
            </label>
          </div>

          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <p className="text-sm text-slate-500">No actions to show.</p>
            </div>
          ) : (
            <div className={tableWrap}>
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
                  <tr>
                    <th className={thCell}>Category</th>
                    <th className={thCell}>Amazon Ref</th>
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
                  {list.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                      <td className={`${tdCell} font-medium text-slate-900 dark:text-slate-100`}>{CATEGORY_LABELS[a.category]}</td>
                      <td className={`${tdCell} font-mono text-xs`}>{a.amazonRef ?? "—"}</td>
                      <td className={tdCell}><SlaBadge sla={a.sla} ageDays={a.ageDays} /></td>
                      <td className={tdCell}><StatusBadge status={a.workflowStatus} /></td>
                      <td className={tdCell}>{a.latestOutcome ? a.latestOutcome.replace(/_/g, " ") : "—"}</td>
                      <td className={`${tdCell} font-mono text-xs`}>{a.referenceValue ?? "—"}</td>
                      <td className={tdCell}>{formatAED(a.amount)}</td>
                      <td className={tdCell}><ConfidenceBadge value={a.confidence} /></td>
                      <td className={tdCell}>
                        <button type="button" onClick={() => setSelected(a)} className={btnSmall}>
                          {a.resolved ? "Update" : "Log action"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
