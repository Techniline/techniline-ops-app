export type {
  ExpectedAction,
  ActionLog,
  ActionCategory,
  WorkflowStatus,
  ReferenceType,
  SlaStatus,
  Confidence,
  OutcomeRequirement,
  OutcomeOption,
  ActionLogInput,
  AmazonAction,
} from "./types";

export {
  categoryForType,
  CATEGORY_LABELS,
  OUTCOMES,
  findOutcome,
  missingKindFor,
} from "./mapping";

export { ageInDays, slaStatus } from "./sla";
export { validateActionLog, deriveConfidence } from "./validation";
export { buildReferenceIndex, isDuplicateReference } from "./duplicate";

export {
  fetchExpectedActions,
  fetchActionLogs,
  logAction,
  fetchAmazonActions,
} from "./queries";

export {
  computeActionSummary,
  missingDocumentationQueue,
  escalatedQueue,
} from "./summary";
export type {
  ActionSummary,
  ExposureBreakdown,
  RecoveryBreakdown,
} from "./summary";
