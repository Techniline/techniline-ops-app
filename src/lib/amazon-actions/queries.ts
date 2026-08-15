import { fetchAll } from "@/lib/finance/accuracy/load";
import { supabase } from "@/lib/supabaseClient";
import type { TablesInsert } from "@/lib/types";

import { buildReferenceIndex, isDuplicateReference } from "./duplicate";
import { categoryForType, findOutcome, missingKindFor } from "./mapping";
import { ageInDays, slaStatus } from "./sla";
import type {
  ActionEnrichment,
  ActionLog,
  ActionLogInput,
  AmazonAction,
  SearchResult,
  WorkflowStatus,
} from "./types";
import { deriveConfidence, validateActionLog } from "./validation";

function enrichmentFromLog(log: ActionLog | null): ActionEnrichment {
  return {
    tleInvoiceNumber: log?.tle_invoice_number ?? null,
    paymentNumber: log?.payment_number ?? null,
    returnId: log?.return_id ?? null,
    srtNumber: log?.srt_number ?? null,
    prtNumber: log?.prt_number ?? null,
    invoiceDate: log?.invoice_date ?? null,
    invoiceValueAed: log?.invoice_value_aed ?? null,
    sku: log?.sku ?? null,
    approvedAmountAed: log?.approved_amount_aed ?? null,
    notes: log?.notes ?? null,
  };
}

function enrichmentFromSubject(subject: string | null): Partial<ActionEnrichment> {
  if (!subject) return {};
  // Extract return IDs from subjects like "…return IDs - 10011049378016"
  const m = subject.match(/\b(\d{12,20})\b/);
  return m ? { returnId: m[1] } : {};
}

function mergeEnrichment(fromLog: ActionEnrichment, fromSubject: Partial<ActionEnrichment>): ActionEnrichment {
  return {
    tleInvoiceNumber: fromLog.tleInvoiceNumber ?? fromSubject.tleInvoiceNumber ?? null,
    paymentNumber: fromLog.paymentNumber ?? fromSubject.paymentNumber ?? null,
    returnId: fromLog.returnId ?? fromSubject.returnId ?? null,
    srtNumber: fromLog.srtNumber ?? fromSubject.srtNumber ?? null,
    prtNumber: fromLog.prtNumber ?? fromSubject.prtNumber ?? null,
    invoiceDate: fromLog.invoiceDate ?? fromSubject.invoiceDate ?? null,
    invoiceValueAed: fromLog.invoiceValueAed ?? fromSubject.invoiceValueAed ?? null,
    sku: fromLog.sku ?? fromSubject.sku ?? null,
    approvedAmountAed: fromLog.approvedAmountAed ?? fromSubject.approvedAmountAed ?? null,
    notes: fromLog.notes ?? fromSubject.notes ?? null,
  };
}

interface ExpectedActionRow {
  id: string;
  type: string;
  status: string;
  ref_number: string | null;
  invoice_ref: string | null;
  aed_amount: number | null;
  email_subject: string | null;
  email_received_at: string;
}

/**
 * When no structured log exists yet, fall back to the legacy
 * `expected_actions.status`: items already `actioned` in v1 are treated as
 * resolved (so they don't flood the queue); `open`/`breached`/`escalated`
 * still need action.
 */
function baseWorkflowFromStatus(status: string): WorkflowStatus {
  return status === "actioned" ? "resolved" : "action_required";
}

/** Load the inbound action feed (RLS scopes to assignee / manager). */
export async function fetchExpectedActions(): Promise<ExpectedActionRow[]> {
  return fetchAll<ExpectedActionRow>((from, to) =>
    supabase
      .from("expected_actions")
      .select(
        "id, type, status, ref_number, invoice_ref, aed_amount, email_subject, email_received_at"
      )
      .range(from, to)
  );
}

/** Load all action log rows (append-only audit trail). */
export async function fetchActionLogs(): Promise<ActionLog[]> {
  return fetchAll<ActionLog>((from, to) =>
    supabase.from("amazon_action_log").select("*").range(from, to)
  );
}

/**
 * Log an action: validate the closure rules, INSERT the log row first, then
 * mark the parent `expected_actions.status = 'actioned'` (existing enum value).
 * Throws on validation failure, insert error, or a zero-row status update.
 */
export async function logAction(input: ActionLogInput): Promise<void> {
  const validationError = validateActionLog(input);
  if (validationError) throw new Error(validationError);

  const option = findOutcome(input.actionType, input.outcome);
  if (!option) throw new Error("Unknown outcome for this action type.");

  const referenceType =
    option.requires === "qty_and_reason" ? "qty" : option.referenceType ?? null;

  const payload: TablesInsert<"amazon_action_log"> = {
    expected_action_id: input.expectedActionId,
    action_type: input.actionType,
    outcome: input.outcome,
    reference_type: referenceType,
    reference_value: input.referenceValue?.trim() || null,
    reason_note: input.reasonNote?.trim() || null,
    workflow_status: option.workflowStatus,
    amount_aed: input.amountAed ?? null,
    recovered_aed: input.recoveredAed ?? null,
    follow_up_date: input.followUpDate ?? null,
    duplicate_warning: input.duplicateWarning ?? false,
    confidence: input.confidence ?? null,
    created_by: input.createdBy,
    // Manual enrichment (all optional)
    tle_invoice_number: input.enrichment?.tleInvoiceNumber?.trim() || null,
    payment_number: input.enrichment?.paymentNumber?.trim() || null,
    return_id: input.enrichment?.returnId?.trim() || null,
    srt_number: input.enrichment?.srtNumber?.trim() || null,
    prt_number: input.enrichment?.prtNumber?.trim() || null,
    invoice_date: input.enrichment?.invoiceDate || null,
    invoice_value_aed: input.enrichment?.invoiceValueAed ?? null,
    sku: input.enrichment?.sku?.trim() || null,
    approved_amount_aed: input.enrichment?.approvedAmountAed ?? null,
    notes: input.enrichment?.notes?.trim() || null,
  };

  // 1) Evidence/audit row first.
  const { error: insertError } = await supabase
    .from("amazon_action_log")
    .insert(payload);
  if (insertError) throw insertError;

  // 2) Mark the parent action handled (within the existing status enum).
  const { data, error: updateError } = await supabase
    .from("expected_actions")
    .update({ status: "actioned" })
    .eq("id", input.expectedActionId)
    .select("id");
  if (updateError) throw updateError;
  if (!data || data.length === 0) {
    throw new Error("Action saved, but the status could not be updated.");
  }

  // 3) Write recovery status back to the linked return so the Returns page
  //    reflects the outcome without needing a separate dispute import.
  const returnId = input.enrichment?.returnId?.trim();
  if (returnId) {
    const returnStatus =
      input.outcome === "credit_received" || input.outcome === "partial_credit_received" ? "recovered" :
      input.outcome === "amazon_rejected" || input.outcome === "closed_no_recovery" ? "rejected" :
      null;
    if (returnStatus) {
      await supabase.from("returns").update({ status: returnStatus }).eq("return_id", returnId);
    }
  }
}

/**
 * Compose the action feed with its latest logged state + derived SLA, exposure,
 * confidence, duplicate, and missing-documentation flags.
 */
export async function fetchAmazonActions(): Promise<AmazonAction[]> {
  const [actions, logs] = await Promise.all([
    fetchExpectedActions(),
    fetchActionLogs(),
  ]);

  const latestByEa = new Map<string, ActionLog>();
  const allLogsByEa = new Map<string, ActionLog[]>();
  for (const log of logs) {
    const current = latestByEa.get(log.expected_action_id);
    if (!current || log.created_at > current.created_at) {
      latestByEa.set(log.expected_action_id, log);
    }
    const arr = allLogsByEa.get(log.expected_action_id) ?? [];
    arr.push(log);
    allLogsByEa.set(log.expected_action_id, arr);
  }

  const refIndex = buildReferenceIndex(logs);
  const now = Date.now();

  return actions.map((ea): AmazonAction => {
    const category = categoryForType(ea.type);
    const log = latestByEa.get(ea.id) ?? null;
    const workflowStatus: WorkflowStatus =
      (log?.workflow_status as WorkflowStatus | undefined) ??
      baseWorkflowFromStatus(ea.status);

    const ageDays = ageInDays(ea.email_received_at, now);
    const sla = slaStatus(ageDays);
    const amount = log?.amount_aed ?? ea.aed_amount ?? null;
    const resolved =
      workflowStatus === "resolved" || workflowStatus === "closed";

    const option = log ? findOutcome(category, log.outcome) : undefined;
    const referenceMissing =
      !!option && option.requires === "reference" && !log?.reference_value;
    const missingDocumentation =
      workflowStatus === "action_required" || referenceMissing;

    const duplicateWarning =
      log?.duplicate_warning ||
      isDuplicateReference(log?.reference_value, refIndex, true);

    const confidence = deriveConfidence({
      invoiceLinked: false, // expected_actions rarely carry an invoice link
      hasReference: !!log?.reference_value,
      hasAmount: amount != null,
      resolved,
    });

    return {
      id: ea.id,
      category,
      rawType: ea.type,
      amazonRef: ea.ref_number,
      invoiceRef: ea.invoice_ref,
      emailSubject: ea.email_subject,
      emailReceivedAt: ea.email_received_at,
      workflowStatus,
      latestOutcome: log?.outcome ?? null,
      referenceType: log?.reference_type ?? null,
      referenceValue: log?.reference_value ?? null,
      reasonNote: log?.reason_note ?? null,
      followUpDate: log?.follow_up_date ?? null,
      amount,
      recovered: log?.recovered_aed ?? null,
      ageDays,
      sla,
      breached: ea.status === "breached",
      confidence,
      resolved,
      missingDocumentation,
      missingKind: missingDocumentation ? missingKindFor(category) : null,
      duplicateWarning,
      enrichment: mergeEnrichment(enrichmentFromLog(log), enrichmentFromSubject(ea.email_subject)),
      allLogs: (allLogsByEa.get(ea.id) ?? []).sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      ),
    };
  });
}

/**
 * Advanced search via the existing read-only `search_all` RPC. Matches across
 * dispute/payment/return/SRT/PRT/invoice/PO/SKU references (incl. historical).
 */
export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase.rpc("search_all", { q });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    category: row.category ?? "",
    sourceTable: row.source_table ?? "",
    id: row.id ?? "",
    primaryLabel: row.primary_label,
    secondaryLabel: row.secondary_label,
    amount: row.amount,
    matchedField: row.matched_field,
  }));
}
