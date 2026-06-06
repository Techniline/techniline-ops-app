export { normalizeRef } from "./normalize";
export { tolerance, withinTolerance } from "./tolerance";

export { analyzeRemittanceAccuracy } from "./remittanceAccuracy";
export { analyzeReturnsAccuracy } from "./returnsAccuracy";
export { analyzeDisputeAccuracy } from "./disputeAccuracy";

export type {
  Confidence,
  InvoiceLink,
  AccuracyFlags,
  MatchReport,
  RemittanceAccuracy,
  ReturnAccuracy,
  DisputeAccuracy,
  RemittanceAccuracyResult,
  ReturnsAccuracyResult,
  DisputeAccuracyResult,
} from "./types";
