import type { TablesInsert } from "@/lib/types";

export type IngestType =
  | "dispute_update"
  | "vendor_po"
  | "po_cancellation"
  | "return_processed"
  | "shortage_claim"
  | "remittance"
  | "unknown";

/** Raw inbound payload from the email forwarder (e.g. a Gmail/Apps Script hook). */
export interface IngestPayload {
  messageId?: string;
  threadId?: string;
  from?: string;
  subject?: string;
  receivedAt?: string;
  bodyText?: string;
  dryRun?: boolean;
}

export type UpsertTable =
  | "expected_actions"
  | "disputes"
  | "returns"
  | "purchase_orders"
  | "remittances"
  | "remittance_lines";

export type UpsertAction = "insert_or_update" | "skip";

/** A single planned write (or an explicit skip with a reason). */
export interface UpsertOperation {
  table: UpsertTable;
  /** Natural key used for dedup/upsert (null → always insert; e.g. lines). */
  naturalKey: { column: string; value: string } | null;
  action: UpsertAction;
  values: Record<string, unknown>;
  reason?: string;
}

export interface ParseResult {
  type: IngestType;
  matched: boolean;
  /** Extracted fields, surfaced in dry-run for visibility. */
  fields: Record<string, unknown>;
  operations: UpsertOperation[];
  notes: string[];
}

export interface ExecutedOperation {
  table: UpsertTable;
  naturalKey: { column: string; value: string } | null;
  result: "inserted" | "updated" | "skipped" | "error";
  id: string | null;
  error?: string;
  reason?: string;
}

export interface IngestResponse {
  ok: boolean;
  dryRun: boolean;
  type: IngestType;
  fields: Record<string, unknown>;
  notes: string[];
  operations: UpsertOperation[] | ExecutedOperation[];
  error?: string;
}

/** Convenience aliases for the insert shapes the parsers build. */
export type ExpectedActionInsert = TablesInsert<"expected_actions">;
export type DisputeInsert = TablesInsert<"disputes">;
export type ReturnInsert = TablesInsert<"returns">;
export type PurchaseOrderInsert = TablesInsert<"purchase_orders">;
export type RemittanceInsert = TablesInsert<"remittances">;
export type RemittanceLineInsert = TablesInsert<"remittance_lines">;
