import {
  amountNear,
  combinedText,
  DEFAULT_ASSIGNEE_ID,
  firstAmount,
  matchOne,
} from "./detectType";
import type {
  ExpectedActionInsert,
  IngestPayload,
  ParseResult,
  ReturnInsert,
  UpsertOperation,
} from "./types";

export function parseReturn(payload: IngestPayload): ParseResult {
  const text = combinedText(payload);

  const returnId =
    matchOne(text, /\bVRET\d+/i) ??
    matchOne(text, /\bRMA[\s#:-]*([A-Z0-9-]+)/i) ??
    matchOne(text, /return[\s#:-]*id[\s#:-]*([A-Z0-9-]+)/i);
  const amount = amountNear(text, /amount|refund|recovery/i) ?? firstAmount(text);

  const receivedAt = payload.receivedAt ?? new Date().toISOString();
  const operations: UpsertOperation[] = [];
  const notes: string[] = [];

  const eaValues: ExpectedActionInsert = {
    type: "return_processed",
    status: "open",
    ref_number: returnId ?? null,
    aed_amount: amount ?? null,
    email_received_at: receivedAt,
    email_subject: payload.subject ?? null,
    email_sender: payload.from ?? null,
    assigned_to: DEFAULT_ASSIGNEE_ID,
  };
  operations.push({
    table: "expected_actions",
    naturalKey: returnId ? { column: "ref_number", value: returnId } : null,
    action: "insert_or_update",
    values: eaValues,
  });

  if (returnId) {
    const returnValues: ReturnInsert = {
      return_id: returnId,
      status: "open",
      total_cost_aed: amount ?? null,
    };
    operations.push({
      table: "returns",
      naturalKey: { column: "return_id", value: returnId },
      action: "insert_or_update",
      values: returnValues,
    });
  } else {
    notes.push("No return id (VRET/RMA) found — returns row not written.");
  }

  notes.push("Return processed → expected_actions type return_processed (open).");

  return {
    type: "return_processed",
    matched: true,
    fields: { returnId, amount },
    operations,
    notes,
  };
}
