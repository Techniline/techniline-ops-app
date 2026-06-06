import type { Tables } from "@/lib/types";

export type ExpectedAction = Tables<"expected_actions">;
export type ActionLog = Tables<"amazon_action_log">;

/** The five business action categories (mapped from expected_actions.type). */
export type ActionCategory =
  | "return"
  | "shortage"
  | "po"
  | "dispute"
  | "remittance";

/** Fine-grained workflow state (stored in amazon_action_log.workflow_status). */
export type WorkflowStatus =
  | "action_required"
  | "waiting_amazon"
  | "resolved"
  | "closed";

export type ReferenceType =
  | "srt"
  | "prt"
  | "dispute"
  | "po_confirmation"
  | "qty"
  | "credit"
  | "return";

export type SlaStatus = "green" | "amber" | "red" | "escalated";

export type Confidence = "high" | "medium" | "low";

/** What a given outcome requires before it can be logged (closure gate). */
export type OutcomeRequirement =
  | "reference"
  | "reason"
  | "note"
  | "eta"
  | "qty_and_reason"
  | "recovered"
  | "recovered_and_note"
  | "none";

export interface OutcomeOption {
  key: string;
  label: string;
  requires: OutcomeRequirement;
  referenceType?: ReferenceType;
  managerOnly?: boolean;
  /** Default workflow status applied when this outcome is chosen. */
  workflowStatus: WorkflowStatus;
}

/** Input for logging an action (one append-only row). */
export interface ActionLogInput {
  expectedActionId: string;
  actionType: ActionCategory;
  outcome: string;
  referenceValue?: string | null;
  reasonNote?: string | null;
  followUpDate?: string | null;
  amountAed?: number | null;
  recoveredAed?: number | null;
  confidence?: Confidence | null;
  duplicateWarning?: boolean;
  createdBy: string;
  /** Whether the acting user is a manager (gates manager-only outcomes). */
  isManager: boolean;
}

/** A composed action: the notification plus its latest logged state + derived fields. */
export interface AmazonAction {
  id: string;
  category: ActionCategory;
  rawType: string;
  amazonRef: string | null;
  invoiceRef: string | null;
  emailSubject: string | null;
  emailReceivedAt: string;

  workflowStatus: WorkflowStatus;
  latestOutcome: string | null;
  referenceType: string | null;
  referenceValue: string | null;
  reasonNote: string | null;
  followUpDate: string | null;

  amount: number | null;
  recovered: number | null;

  ageDays: number;
  sla: SlaStatus;
  confidence: Confidence;
  resolved: boolean;
  missingDocumentation: boolean;
  missingKind: string | null;
  duplicateWarning: boolean;
}
