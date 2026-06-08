/** Shared types for the LP (Local Purchase Order) PDF capture flow (client + server). */

/** One product line captured from an LPO (maps to an `lp_items` row). */
export interface LpLineItem {
  lineNumber: number | null;
  brand: string | null;
  modelNo: string | null; // the SKU / model code, e.g. "XV1R"
  description: string | null;
  qty: number | null;
  unitPrice: number | null;
  amount: number | null;
  discAmount: number | null;
}

/** The auto-captured LPO draft returned by the parse endpoint (pre-verify). */
export interface LpDraft {
  lpNumber: string | null;
  lpDate: string | null; // ISO YYYY-MM-DD
  vendorName: string | null;
  vendorTrn: string | null;
  consigneeTrn: string | null;
  qtnRef: string | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  netAmount: number | null;
  terms: string | null;
  lineItems: LpLineItem[];
}

/** Which capture engine produced a draft. */
export type CaptureEngine = "ai" | "basic";

/** Parse result: the draft plus which engine produced it. */
export interface ParsedLp {
  draft: LpDraft;
  engine: CaptureEngine;
}
