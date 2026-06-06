import { fetchAll } from "@/lib/finance/accuracy/load";
import { supabase } from "@/lib/supabaseClient";
import type { TablesInsert } from "@/lib/types";

import { buildReferenceIndex, isDuplicateReference } from "./duplicate";
import { categoryForType, findOutcome, missingKindFor } from "./mapping";
import { ageInDays, slaStatus } from "./sla";
import type {
  ActionLog,
  ActionLogInput,
  AmazonAction,
  WorkflowStatus,
} from "./types";
import { deriveConfidence, validateActionLog } from "./validation";

interface ExpectedActionRow {
  id: string;
  type: string;
  ref_number: string | null;
  invoice_ref: string | null;
  aed_amount: number | null;
  email_subject: string | null;
  email_received_at: string;
}

/** Load the inbound action feed (RLS scopes to assignee / manager). */
export async function fetchExpectedActions(): Promise<ExpectedActionRow[]> {
  return fetchAll<ExpectedActionRow>((from, to) =>
    supabase
      .from("expected_actions")
      .select(
        "id, type, ref_number, invoice_ref, aed_amount, email_subject, email_received_at"
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
  for (const log of logs) {
    const current = latestByEa.get(log.expected_action_id);
    if (!current || log.created_at > current.created_at) {
      latestByEa.set(log.expected_action_id, log);
    }
  }

  const refIndex = buildReferenceIndex(logs);
  const now = Date.now();

  return actions.map((ea): AmazonAction => {
    const category = categoryForType(ea.type);
    const log = latestByEa.get(ea.id) ?? null;
    const workflowStatus: WorkflowStatus =
      (log?.workflow_status as WorkflowStatus | undefined) ?? "action_required";

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
      confidence,
      resolved,
      missingDocumentation,
      missingKind: missingDocumentation ? missingKindFor(category) : null,
      duplicateWarning,
    };
  });
}
