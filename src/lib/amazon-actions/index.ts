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
  ActionEnrichment,
  AmazonAction,
  SearchResult,
} from "./types";

export {
  categoryForType,
  CATEGORY_LABELS,
  OUTCOMES,
  findOutcome,
  missingKindFor,
  operationalStatusLabel,
} from "./mapping";

export { ageInDays, slaStatus } from "./sla";
export { validateActionLog, deriveConfidence } from "./validation";
export { buildReferenceIndex, isDuplicateReference } from "./duplicate";

export {
  fetchExpectedActions,
  fetchActionLogs,
  logAction,
  fetchAmazonActions,
  searchAll,
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
