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
  const lower = text.toLowerCase();

  // Count of POs to confirm — handle number-after ("to confirm 0", "to confirm: 0"),
  // number-before ("5 new purchase orders"), "unconfirmed N", "count = N", "N no action needed".
  const countStr =
    matchOne(text, /to\s*confirm[:\s]+([0-9]+)/i) ??
    matchOne(text, /([0-9]+)\s+(?:new\s+)?(?:purchase orders?|pos)\b/i) ??
    matchOne(text, /unconfirmed[^0-9]{0,20}([0-9]+)/i) ??
    matchOne(text, /count[^0-9]{0,8}=?\s*([0-9]+)/i) ??
    matchOne(text, /([0-9]+)\s*no action needed/i);
  const unconfirmedCount = countStr != null ? Number(countStr) : null;
  const noActionNeeded = /no action needed/.test(lower);

  const poNumber =
    matchOne(text, /\bPO[\s#:-]*([0-9]{5,})/i) ??
    matchOne(text, /purchase order[\s#:-]*([0-9]{5,})/i);

  const receivedAt = payload.receivedAt ?? new Date().toISOString();
  const notes: string[] = [];

  // Gate (vendor_po): only create an action when there's a PO number OR a
  // positive count. Zero count / "no action needed" / nothing parseable → none.
  if (type === "vendor_po") {
    const positiveCount = unconfirmedCount != null && unconfirmedCount > 0;
    if (!poNumber && !positiveCount) {
      const zeroish = unconfirmedCount === 0 || noActionNeeded;
      notes.push(
        zeroish
          ? "No PO action required (0 to confirm / no action needed)."
          : "No PO number and no positive unconfirmed count — no open PO action created."
      );
      return {
        type,
        matched: true,
        fields: {
          unconfirmedCount: unconfirmedCount ?? (noActionNeeded ? 0 : null),
          poNumber: null,
        },
        operations: [],
        notes,
      };
    }
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
          unconfirmedCount != null
            ? ` (${unconfirmedCount} to confirm)`
            : poNumber
              ? ` (PO ${poNumber})`
              : ""
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
