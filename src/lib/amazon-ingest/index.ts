export { parseEmail } from "./parseEmail";
export { detectType } from "./detectType";
export { executePlan } from "./upsert";
export { SAMPLE_PAYLOADS } from "./samples";
export { runPoll } from "./poll";
export type { PollSummary, PollItem } from "./poll";
export type {
  IngestType,
  IngestPayload,
  ParseResult,
  UpsertOperation,
  ExecutedOperation,
  IngestResponse,
} from "./types";
