import type { ActionCategory, OutcomeOption } from "./types";

/** Map the DB `expected_actions.type` onto a business category. */
export function categoryForType(type: string): ActionCategory {
  switch (type) {
    case "return_processed":
      return "return";
    case "shortage_claim":
      return "shortage";
    case "vendor_po":
    case "po_cancellation":
      return "po";
    case "dispute_update":
      return "dispute";
    case "remittance":
      return "remittance";
    default:
      return "po";
  }
}

export const CATEGORY_LABELS: Record<ActionCategory, string> = {
  return: "Return Action",
  shortage: "Shortage Claim",
  po: "PO Confirmation",
  dispute: "Dispute Follow-Up",
  remittance: "Remittance Review",
};

/**
 * Outcome options per category, with their closure requirements.
 *
 * NOTE: `return`, `shortage`, and `po` outcomes are exactly as specified.
 * `dispute` and `remittance` outcomes were NOT enumerated in the spec — these
 * are proposed defaults to confirm/adjust.
 */
export const OUTCOMES: Record<ActionCategory, OutcomeOption[]> = {
  return: [
    { key: "srt_raised", label: "SRT Raised", requires: "reference", referenceType: "srt", workflowStatus: "waiting_amazon" },
    { key: "prt_raised", label: "PRT Raised", requires: "reference", referenceType: "prt", workflowStatus: "waiting_amazon" },
    { key: "dispute_raised", label: "Dispute Raised", requires: "reference", referenceType: "dispute", workflowStatus: "waiting_amazon" },
    { key: "return_accepted", label: "Return Accepted", requires: "note", workflowStatus: "resolved" },
    { key: "invalid_return", label: "Invalid Return", requires: "reason", workflowStatus: "resolved" },
    { key: "waiting_amazon", label: "Waiting Amazon", requires: "note", workflowStatus: "waiting_amazon" },
  ],
  shortage: [
    { key: "dispute_raised", label: "Dispute Raised", requires: "reference", referenceType: "dispute", workflowStatus: "waiting_amazon" },
    { key: "srt_raised", label: "SRT Raised", requires: "reference", referenceType: "srt", workflowStatus: "waiting_amazon" },
    { key: "prt_raised", label: "PRT Raised", requires: "reference", referenceType: "prt", workflowStatus: "waiting_amazon" },
    { key: "item_delivered", label: "Item Delivered", requires: "note", workflowStatus: "resolved" },
    { key: "item_rejected", label: "Item Rejected", requires: "reason", workflowStatus: "resolved" },
    { key: "po_cancelled", label: "PO Cancelled", requires: "reason", workflowStatus: "resolved" },
    { key: "waiting_amazon", label: "Waiting Amazon", requires: "note", workflowStatus: "waiting_amazon" },
    { key: "accepted_write_off", label: "Accepted Write-Off", requires: "reason", managerOnly: true, workflowStatus: "closed" },
  ],
  po: [
    { key: "confirmed", label: "Confirmed", requires: "note", workflowStatus: "resolved" },
    { key: "rejected", label: "Rejected", requires: "reason", workflowStatus: "resolved" },
    { key: "partial_confirmed", label: "Partial Confirmed", requires: "qty_and_reason", referenceType: "qty", workflowStatus: "resolved" },
    { key: "waiting_stock", label: "Waiting Stock", requires: "eta", workflowStatus: "waiting_amazon" },
    { key: "cancelled", label: "Cancelled", requires: "reason", workflowStatus: "resolved" },
  ],
  // Proposed (confirm): dispute follow-up outcomes
  dispute: [
    { key: "credit_received", label: "Credit Received", requires: "reference", referenceType: "credit", workflowStatus: "resolved" },
    { key: "amazon_rejected", label: "Amazon Rejected", requires: "reason", workflowStatus: "resolved" },
    { key: "waiting_amazon", label: "Waiting Amazon", requires: "note", workflowStatus: "waiting_amazon" },
    { key: "closed", label: "Closed", requires: "note", workflowStatus: "closed" },
  ],
  // Proposed (confirm): remittance review outcomes
  remittance: [
    { key: "reviewed_ok", label: "Reviewed — OK", requires: "note", workflowStatus: "resolved" },
    { key: "variance_found", label: "Variance Found", requires: "reason", workflowStatus: "waiting_amazon" },
    { key: "dispute_raised", label: "Dispute Raised", requires: "reference", referenceType: "dispute", workflowStatus: "waiting_amazon" },
    { key: "waiting_amazon", label: "Waiting Amazon", requires: "note", workflowStatus: "waiting_amazon" },
  ],
};

export function findOutcome(
  category: ActionCategory,
  key: string
): OutcomeOption | undefined {
  return OUTCOMES[category].find((o) => o.key === key);
}

/** Human label for what's missing when an action is not yet documented. */
export function missingKindFor(category: ActionCategory): string {
  switch (category) {
    case "po":
      return "Missing PO Confirmation";
    case "return":
      return "Missing SRT / PRT / Dispute";
    case "shortage":
      return "Missing claim reference";
    case "dispute":
      return "Missing Dispute follow-up";
    case "remittance":
      return "Missing review";
  }
}
