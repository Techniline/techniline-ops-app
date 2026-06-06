import {
  allAmounts,
  amountNear,
  combinedText,
  DEFAULT_ASSIGNEE_ID,
  firstAmount,
  matchOne,
} from "./detectType";
import type {
  DisputeInsert,
  ExpectedActionInsert,
  IngestPayload,
  ParseResult,
  UpsertOperation,
} from "./types";

export function parseDispute(payload: IngestPayload): ParseResult {
  const text = combinedText(payload);
  const lower = text.toLowerCase();

  const disputeNumber = matchOne(text, /\bDSPT\d+/i);
  const labeledApproved = amountNear(text, /approved\s*amount/i);

  let disputeStatus: string;
  let eaStatus: "open" | "actioned";
  let outcome: string;
  if (/re-?open/.test(lower)) {
    disputeStatus = "open";
    eaStatus = "open";
    outcome = "reopened";
  } else if (/reject|denied/.test(lower)) {
    disputeStatus = "amazon_rejected";
    eaStatus = "actioned";
    outcome = "rejected";
  } else if (/approved|resolved/.test(lower)) {
    disputeStatus = "amazon_approved";
    eaStatus = "actioned";
    outcome = "approved";
  } else if (/pending|awaiting|under review/.test(lower)) {
    disputeStatus = "awaiting_amazon";
    eaStatus = "open";
    outcome = "pending";
  } else {
    disputeStatus = "open";
    eaStatus = "open";
    outcome = "open";
  }

  // Amount resolution.
  // - Prefer an explicitly labeled "approved amount".
  // - For approved/resolved with two unlabeled AED amounts, the first is the
  //   claim/invoice amount and the second is the approved amount.
  // - With a single amount on an approved/resolved dispute, approved = amount.
  const amounts = allAmounts(text);
  const invoiceAmount =
    amounts[0] ?? amountNear(text, /amount/i) ?? firstAmount(text) ?? null;

  let approvedAmount: number | null = labeledApproved;
  if (approvedAmount == null && outcome === "approved") {
    if (amounts.length >= 2) approvedAmount = amounts[1];
    else if (amounts.length === 1) approvedAmount = amounts[0];
  }

  const receivedAt = payload.receivedAt ?? new Date().toISOString();
  const operations: UpsertOperation[] = [];
  const notes: string[] = [];

  if (disputeNumber) {
    const disputeValues: DisputeInsert = {
      dispute_number: disputeNumber,
      dispute_status: disputeStatus,
      invoice_amount_aed: invoiceAmount ?? 0, // NOT NULL column — default to 0 when unknown
      approved_amount_aed: approvedAmount ?? null,
    };
    operations.push({
      table: "disputes",
      naturalKey: { column: "dispute_number", value: disputeNumber },
      action: "insert_or_update",
      values: disputeValues,
    });
  } else {
    notes.push("No dispute number (DSPT…) found — dispute row not written.");
  }

  const eaValues: ExpectedActionInsert = {
    type: "dispute_update",
    status: eaStatus,
    ref_number: disputeNumber ?? null,
    aed_amount: invoiceAmount ?? null,
    email_received_at: receivedAt,
    email_subject: payload.subject ?? null,
    email_sender: payload.from ?? null,
    assigned_to: DEFAULT_ASSIGNEE_ID,
  };
  operations.push({
    table: "expected_actions",
    naturalKey: disputeNumber ? { column: "ref_number", value: disputeNumber } : null,
    action: "insert_or_update",
    values: eaValues,
  });

  notes.push(
    `Dispute outcome '${outcome}' → dispute_status='${disputeStatus}', expected_actions.status='${eaStatus}'.`
  );

  return {
    type: "dispute_update",
    matched: true,
    fields: { disputeNumber, amount: invoiceAmount, approvedAmount, outcome },
    operations,
    notes,
  };
}
