/** Shared types for the Cocoblu PDF invoice capture flow (client + server). */

/** One product line captured from an invoice (maps to a cocoblu_ageing row). */
export interface InvoiceLineItem {
  sku: string;
  description: string | null;
  brand: string | null;
  qty: number | null;
  unitCost: number | null;
}

/** The auto-captured invoice draft returned by the parse endpoint (pre-verify). */
export interface InvoiceDraft {
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO YYYY-MM-DD
  suppliedDate: string | null; // ISO YYYY-MM-DD or null
  lineItems: InvoiceLineItem[];
}

/** Which capture engine produced a draft. */
export type CaptureEngine = "ai" | "basic";

/** Parse result: the draft plus which engine produced it. */
export interface ParsedInvoice {
  draft: InvoiceDraft;
  engine: CaptureEngine;
}
