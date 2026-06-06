export type Confidence = "high" | "medium" | "low";

export type InvoiceLink = "exact" | "normalized" | "none";

export interface AccuracyFlags {
  matched: boolean;
  unmatched: boolean;
  amount_mismatch: boolean;
  duplicate_reference: boolean;
  missing_invoice_link: boolean;
  needs_review: boolean;
}

/** Aggregate invoice-matching report for a domain. */
export interface MatchReport {
  /** Lines/records matched to an invoice by exact invoice number. */
  exactMatches: number;
  /** Total matched once normalization is applied (exact + normalized-only). */
  normalizedMatches: number;
  /** Matches gained purely from normalization (normalizedMatches − exactMatches). */
  additionalFromNormalization: number;
  /** Records with an invoice number that matched neither exact nor normalized. */
  unmatched: number;
  /** Up to 10 example unmatched invoice numbers. */
  topUnmatched: string[];
}

export interface RemittanceAccuracy {
  remittanceRef: string;
  paymentDate: string | null;
  gross: number | null;
  deductions: number | null;
  net: number | null;
  /** (gross − deductions) − net; should be ≈ 0. */
  headerVariance: number;
  withinHeaderTolerance: boolean;
  payableLineCount: number;
  linkedPayableCount: number;
  unmatchedPayableCount: number;
  linkedPercentage: number;
  flags: AccuracyFlags;
  confidence: Confidence;
}

export interface ReturnAccuracy {
  returnRef: string;
  sku: string | null;
  totalCostAed: number | null;
  invoiceLink: InvoiceLink;
  linkedInvoiceNumber: string | null;
  duplicateRisk: boolean;
  missingFields: string[];
  ageDays: number | null;
  status: string | null;
  flags: AccuracyFlags;
  confidence: Confidence;
}

export interface DisputeAccuracy {
  disputeNumber: string;
  invoiceAmount: number | null;
  creditAmount: number | null;
  /** invoiceAmount − creditAmount (null if either missing). */
  variance: number | null;
  withinTolerance: boolean;
  invoiceLink: InvoiceLink;
  linkedInvoiceNumber: string | null;
  disputeItemsCount: number;
  recoveryStatus: string;
  flags: AccuracyFlags;
  confidence: Confidence;
}

export interface RemittanceAccuracyResult {
  rows: RemittanceAccuracy[];
  matchReport: MatchReport;
}

export interface ReturnsAccuracyResult {
  rows: ReturnAccuracy[];
  matchReport: MatchReport;
}

export interface DisputeAccuracyResult {
  rows: DisputeAccuracy[];
  matchReport: MatchReport;
}
