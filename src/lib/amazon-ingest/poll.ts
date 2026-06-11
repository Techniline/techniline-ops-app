import { fetchBody, fetchMessages, type GraphMessage } from "./graph";
import { alreadyProcessed, recordProcessedMessages, recordRunHeartbeat } from "./ingestLog";
import { parseEmail } from "./parseEmail";
import { executePlan } from "./upsert";

const DEFAULT_MAILBOXES = ["vihan@techniline.org", "purchasing@techniline.org"];

function mailboxes(): string[] {
  const raw = process.env.INGEST_MAILBOXES;
  if (!raw) return DEFAULT_MAILBOXES;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is this an Amazon-related email we should ingest? (subject + sender only) */
function isAmazonEmail(msg: GraphMessage): boolean {
  const from = (msg.fromAddress ?? "").toLowerCase();
  if (from.includes("amazon")) return true;
  const subj = (msg.subject ?? "").toLowerCase();
  return /dspt|purchase order|\bpo\(s\)|shortage|remittance advice|dispute|vendor return|been cancelled/.test(
    subj
  );
}

/** Run async `fn` over `items` with at most `limit` in flight. Preserves order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return out;
}

export interface PollItem {
  mailbox: string;
  messageId: string;
  subject: string | null;
  type: string;
  operations: number;
  result: "dry-run" | "written" | "skipped_duplicate" | "error";
  error?: string;
  lineOps?: number; // remittance_lines ops emitted (parsed invoice lines)
  opErrors?: number; // per-operation write failures
  firstOpError?: string;
  notes?: string[];
}

export interface PollSummary {
  dryRun: boolean;
  lookbackHours: number;
  mailboxes: string[];
  fetched: number;
  amazon: number;
  written: number;
  skipped: number;
  errors: number;
  items: PollItem[];
}

interface Candidate {
  mailbox: string;
  msg: GraphMessage;
  messageId: string;
}

/**
 * Poll the configured mailboxes for Amazon emails received within the lookback
 * window, parse each, and (unless dryRun) upsert + record the message id so it
 * is never reprocessed. Idempotent + self-healing.
 *
 * Performance: only message HEADERS are fetched for the whole window; bodies are
 * downloaded (in parallel) only for the Amazon matches, dedup is a single bulk
 * query, and the ingest_log rows are written in one batch — so even a wide
 * backfill stays within the serverless time limit.
 */
export async function runPoll(opts: {
  dryRun: boolean;
  lookbackHours: number;
  force?: boolean;
}): Promise<PollSummary> {
  const sinceIso = new Date(
    Date.now() - opts.lookbackHours * 3_600_000
  ).toISOString();
  const boxes = mailboxes();

  const items: PollItem[] = [];
  let fetched = 0;
  let amazon = 0;
  let written = 0;
  let skipped = 0;
  let errors = 0;

  // 1) Fetch headers per mailbox; keep Amazon matches, dedup by message id
  //    (the same email forwarded to two mailboxes shares an internetMessageId).
  const candidates: Candidate[] = [];
  const seenIds = new Set<string>();
  for (const mailbox of boxes) {
    const headers = await fetchMessages(mailbox, sinceIso);
    fetched += headers.length;
    for (const msg of headers) {
      if (!isAmazonEmail(msg)) continue;
      amazon += 1;
      const messageId = msg.internetMessageId ?? msg.id;
      if (seenIds.has(messageId)) {
        skipped += 1;
        items.push({
          mailbox,
          messageId,
          subject: msg.subject,
          type: "(duplicate)",
          operations: 0,
          result: "skipped_duplicate",
        });
        continue;
      }
      seenIds.add(messageId);
      candidates.push({ mailbox, msg, messageId });
    }
  }

  // 2) Decide which candidates still need processing. `force` reprocesses even
  //    already-ingested emails (re-parse with the current parser; writes are
  //    idempotent by natural key).
  let toProcess = candidates;
  if (!opts.dryRun && !opts.force) {
    const processed = await alreadyProcessed(candidates.map((c) => c.messageId));
    toProcess = [];
    for (const c of candidates) {
      if (processed.has(c.messageId)) {
        skipped += 1;
        items.push({
          mailbox: c.mailbox,
          messageId: c.messageId,
          subject: c.msg.subject,
          type: "(already ingested)",
          operations: 0,
          result: "skipped_duplicate",
        });
      } else {
        toProcess.push(c);
      }
    }
  }

  // 3) Download bodies for just those, in parallel, and parse.
  const parsed = await mapLimit(toProcess, 8, async (c) => {
    const bodyText = (await fetchBody(c.mailbox, c.msg.id)) ?? undefined;
    return {
      c,
      result: parseEmail({
        messageId: c.messageId,
        from: c.msg.fromAddress ?? undefined,
        subject: c.msg.subject ?? undefined,
        receivedAt: c.msg.receivedDateTime ?? undefined,
        bodyText,
      }),
    };
  });

  // 4) Dry-run: just report. Live: upsert sequentially (no duplicate-ref races),
  //    then batch-record everything that succeeded.
  if (opts.dryRun) {
    for (const { c, result } of parsed) {
      items.push({
        mailbox: c.mailbox,
        messageId: c.messageId,
        subject: c.msg.subject,
        type: result.type,
        operations: result.operations.length,
        result: "dry-run",
      });
    }
  } else {
    const toRecord: Array<{
      messageId: string;
      mailbox: string;
      receivedAt: string | null;
      emailType: string;
    }> = [];
    for (const { c, result } of parsed) {
      try {
        const executed = await executePlan(result.operations);
        const opErrs = executed.filter((o) => o.result === "error");
        const lineOps = result.operations.filter((o) => o.table === "remittance_lines").length;
        written += 1;
        toRecord.push({
          messageId: c.messageId,
          mailbox: c.mailbox,
          receivedAt: c.msg.receivedDateTime,
          emailType: result.type,
        });
        items.push({
          mailbox: c.mailbox,
          messageId: c.messageId,
          subject: c.msg.subject,
          type: result.type,
          operations: result.operations.length,
          result: "written",
          lineOps,
          opErrors: opErrs.length,
          firstOpError: opErrs[0]?.error,
          notes: result.notes,
        });
      } catch (err) {
        errors += 1;
        items.push({
          mailbox: c.mailbox,
          messageId: c.messageId,
          subject: c.msg.subject,
          type: result.type,
          operations: result.operations.length,
          result: "error",
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
    await recordProcessedMessages(toRecord);
    await recordRunHeartbeat({ written, skipped, errors });
  }

  return {
    dryRun: opts.dryRun,
    lookbackHours: opts.lookbackHours,
    mailboxes: boxes,
    fetched,
    amazon,
    written,
    skipped,
    errors,
    items,
  };
}
