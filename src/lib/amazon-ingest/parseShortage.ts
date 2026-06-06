import {
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

export function parseShortage(payload: IngestPayload): ParseResult {
  const text = combinedText(payload);
  const lower = text.toLowerCase();

  const dspt = matchOne(text, /\bDSPT\d+/i);
  const ref = dspt ?? matchOne(text, /\bclaim[\s#:]*([A-Z0-9-]+)/i);
  const amount = amountNear(text, /amount/i) ?? firstAmount(text);
  const pending = /pending|awaiting/.test(lower);
  const eaStatus: "open" | "actioned" = /resolved|approved|closed/.test(lower)
    ? "actioned"
    : "open";

  const receivedAt = payload.receivedAt ?? new Date().toISOString();
  const operations: UpsertOperation[] = [];
  const notes: string[] = [];

  const eaValues: ExpectedActionInsert = {
    type: "shortage_claim",
    status: eaStatus,
    ref_number: ref ?? null,
    aed_amount: amount ?? null,
    email_received_at: receivedAt,
    email_subject: payload.subject ?? null,
    email_sender: payload.from ?? null,
    assigned_to: DEFAULT_ASSIGNEE_ID,
  };
  operations.push({
    table: "expected_actions",
    naturalKey: ref ? { column: "ref_number", value: ref } : null,
    action: "insert_or_update",
    values: eaValues,
  });

  // A shortage often carries a DSPT — track it as a pending dispute too.
  if (dspt) {
    const disputeValues: DisputeInsert = {
      dispute_number: dspt,
      dispute_status: pending ? "awaiting_amazon" : "open",
      invoice_amount_aed: amount ?? 0,
    };
    operations.push({
      table: "disputes",
      naturalKey: { column: "dispute_number", value: dspt },
      action: "insert_or_update",
      values: disputeValues,
    });
  }

  notes.push(
    `Shortage claim${ref ? ` (${ref})` : ""} → expected_actions type shortage_claim, status='${eaStatus}'.`
  );

  return {
    type: "shortage_claim",
    matched: true,
    fields: { ref, amount, pending },
    operations,
    notes,
  };
}
