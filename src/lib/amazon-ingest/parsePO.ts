import { combinedText, DEFAULT_ASSIGNEE_ID, matchOne } from "./detectType";
import type {
  ExpectedActionInsert,
  IngestPayload,
  IngestType,
  ParseResult,
  UpsertOperation,
} from "./types";

export function parsePO(
  payload: IngestPayload,
  type: Extract<IngestType, "vendor_po" | "po_cancellation">
): ParseResult {
  const text = combinedText(payload);

  const countStr =
    matchOne(text, /unconfirmed[^0-9]{0,20}(\d+)/i) ??
    matchOne(text, /count[^0-9]{0,6}=?\s*(\d+)/i);
  const unconfirmedCount = countStr != null ? Number(countStr) : null;
  const poNumber =
    matchOne(text, /\bPO[\s#:-]*([0-9]{5,})/i) ??
    matchOne(text, /purchase order[\s#:-]*([0-9]{5,})/i);

  const receivedAt = payload.receivedAt ?? new Date().toISOString();
  const notes: string[] = [];

  // Rule: a PO summary with 0 unconfirmed POs must NOT create an open action.
  if (type === "vendor_po" && unconfirmedCount === 0) {
    notes.push("Unconfirmed PO count is 0 — no open PO action created.");
    return {
      type,
      matched: true,
      fields: { unconfirmedCount: 0, poNumber },
      operations: [],
      notes,
    };
  }

  const eaValues: ExpectedActionInsert = {
    type,
    status: "open",
    ref_number: poNumber ?? null,
    po_number: poNumber ?? null,
    email_received_at: receivedAt,
    email_subject: payload.subject ?? null,
    email_sender: payload.from ?? null,
    assigned_to: DEFAULT_ASSIGNEE_ID,
  };
  const operations: UpsertOperation[] = [
    {
      table: "expected_actions",
      naturalKey: poNumber ? { column: "ref_number", value: poNumber } : null,
      action: "insert_or_update",
      values: eaValues,
    },
  ];

  notes.push(
    type === "po_cancellation"
      ? "PO cancellation → expected_actions type po_cancellation (open)."
      : `PO confirmation needed${
          unconfirmedCount != null ? ` (${unconfirmedCount} unconfirmed)` : ""
        } → expected_actions type vendor_po (open).`
  );

  return {
    type,
    matched: true,
    fields: { unconfirmedCount, poNumber },
    operations,
    notes,
  };
}
