import { amountNear, combinedText, DEFAULT_ASSIGNEE_ID, matchOne } from "./detectType";
import type {
  ExpectedActionInsert,
  IngestPayload,
  ParseResult,
  RemittanceInsert,
  UpsertOperation,
} from "./types";

export function parseRemittance(payload: IngestPayload): ParseResult {
  const text = combinedText(payload);

  const remittanceRef =
    matchOne(text, /remittance[\s#:-]*(?:ref|number|id)?[\s#:-]*([A-Z0-9-]{6,})/i) ??
    matchOne(text, /payment[\s#:-]*(?:number|no|ref)[\s#:-]*([A-Z0-9-]{6,})/i) ??
    matchOne(text, /\b\d{9,}\b/);
  const netPaid = amountNear(text, /net\s*paid|net\s*payment/i);
  const gross = amountNear(text, /gross/i);
  const deductions = amountNear(text, /deduction/i);

  const receivedAt = payload.receivedAt ?? new Date().toISOString();
  const operations: UpsertOperation[] = [];
  const notes: string[] = [];

  if (remittanceRef) {
    const remittanceValues: RemittanceInsert = {
      remittance_ref: remittanceRef,
      net_paid_aed: netPaid ?? null,
      gross_amount_aed: gross ?? null,
      deductions_aed: deductions ?? null,
      payment_date: payload.receivedAt ? payload.receivedAt.slice(0, 10) : null,
    };
    operations.push({
      table: "remittances",
      naturalKey: { column: "remittance_ref", value: remittanceRef },
      action: "insert_or_update",
      values: remittanceValues,
    });
  } else {
    notes.push("No remittance reference found — remittance row not written.");
  }

  const eaValues: ExpectedActionInsert = {
    type: "remittance",
    status: "open",
    ref_number: remittanceRef ?? null,
    aed_amount: netPaid ?? null,
    email_received_at: receivedAt,
    email_subject: payload.subject ?? null,
    email_sender: payload.from ?? null,
    assigned_to: DEFAULT_ASSIGNEE_ID,
  };
  operations.push({
    table: "expected_actions",
    naturalKey: remittanceRef ? { column: "ref_number", value: remittanceRef } : null,
    action: "insert_or_update",
    values: eaValues,
  });

  notes.push(
    "Remittance → upsert remittances + expected_actions type remittance (open). Line items are not parsed from a notification email."
  );

  return {
    type: "remittance",
    matched: true,
    fields: { remittanceRef, netPaid, gross, deductions },
    operations,
    notes,
  };
}
