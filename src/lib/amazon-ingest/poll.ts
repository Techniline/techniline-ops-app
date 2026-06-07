import { fetchMessages, type GraphMessage } from "./graph";
import { hasProcessedMessage, recordProcessedMessage } from "./ingestLog";
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

/** Is this an Amazon-related email we should ingest? */
function isAmazonEmail(msg: GraphMessage): boolean {
  const from = (msg.fromAddress ?? "").toLowerCase();
  if (from.includes("amazon")) return true;
  const subj = (msg.subject ?? "").toLowerCase();
  return /dspt|purchase order|\bpo\(s\)|shortage|remittance advice|dispute|vendor return|been cancelled/.test(
    subj
  );
}

export interface PollItem {
  mailbox: string;
  messageId: string;
  subject: string | null;
  type: string;
  operations: number;
  result: "dry-run" | "written" | "skipped_duplicate" | "error";
  error?: string;
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

/**
 * Poll the configured mailboxes for Amazon emails received within the lookback
 * window, parse each, and (unless dryRun) upsert + record the message id so it
 * is never reprocessed. Idempotent + self-healing: an overlapping window plus
 * message-id dedup means missed runs simply catch up next time.
 */
export async function runPoll(opts: {
  dryRun: boolean;
  lookbackHours: number;
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

  for (const mailbox of boxes) {
    const messages = await fetchMessages(mailbox, sinceIso);
    fetched += messages.length;

    for (const msg of messages) {
      if (!isAmazonEmail(msg)) continue;
      amazon += 1;
      const messageId = msg.internetMessageId ?? msg.id;

      const parsed = parseEmail({
        messageId,
        from: msg.fromAddress ?? undefined,
        subject: msg.subject ?? undefined,
        receivedAt: msg.receivedDateTime ?? undefined,
        bodyText: msg.bodyContent ?? undefined,
      });

      if (opts.dryRun) {
        items.push({
          mailbox,
          messageId,
          subject: msg.subject,
          type: parsed.type,
          operations: parsed.operations.length,
          result: "dry-run",
        });
        continue;
      }

      try {
        if (await hasProcessedMessage(messageId)) {
          skipped += 1;
          items.push({
            mailbox,
            messageId,
            subject: msg.subject,
            type: parsed.type,
            operations: 0,
            result: "skipped_duplicate",
          });
          continue;
        }

        await executePlan(parsed.operations);
        await recordProcessedMessage({
          messageId,
          mailbox,
          receivedAt: msg.receivedDateTime,
          emailType: parsed.type,
        });
        written += 1;
        items.push({
          mailbox,
          messageId,
          subject: msg.subject,
          type: parsed.type,
          operations: parsed.operations.length,
          result: "written",
        });
      } catch (err) {
        errors += 1;
        items.push({
          mailbox,
          messageId,
          subject: msg.subject,
          type: parsed.type,
          operations: parsed.operations.length,
          result: "error",
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
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
