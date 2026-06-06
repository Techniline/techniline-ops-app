import { detectType } from "./detectType";
import { parseDispute } from "./parseDispute";
import { parsePO } from "./parsePO";
import { parseRemittance } from "./parseRemittance";
import { parseReturn } from "./parseReturn";
import { parseShortage } from "./parseShortage";
import type { IngestPayload, ParseResult } from "./types";

/** Detect the email type and run the matching parser into an upsert plan. */
export function parseEmail(payload: IngestPayload): ParseResult {
  const type = detectType(payload);
  switch (type) {
    case "dispute_update":
      return parseDispute(payload);
    case "shortage_claim":
      return parseShortage(payload);
    case "vendor_po":
      return parsePO(payload, "vendor_po");
    case "po_cancellation":
      return parsePO(payload, "po_cancellation");
    case "return_processed":
      return parseReturn(payload);
    case "remittance":
      return parseRemittance(payload);
    default:
      return {
        type: "unknown",
        matched: false,
        fields: {},
        operations: [],
        notes: ["Unrecognized email type — no operations planned."],
      };
  }
}

export { detectType } from "./detectType";
export { executePlan } from "./upsert";
export { SAMPLE_PAYLOADS } from "./samples";
export type {
  IngestType,
  IngestPayload,
  ParseResult,
  UpsertOperation,
  ExecutedOperation,
  IngestResponse,
} from "./types";
