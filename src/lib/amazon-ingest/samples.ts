import type { IngestPayload } from "./types";

/** Known example emails for dry-run testing. */
export const SAMPLE_PAYLOADS: Record<string, IngestPayload> = {
  // 1. Resolved vendor return dispute, 1,771 AED approved.
  disputeResolvedApproved: {
    messageId: "sample-dispute-resolved",
    from: "vendor-notifications@amazon.com",
    subject: "Dispute DSPT20065219423 resolved",
    receivedAt: "2026-06-01T08:00:00Z",
    bodyText:
      "Your vendor return dispute DSPT20065219423 has been resolved. Amount: 1,771 AED. Approved amount: 1,771 AED.",
    dryRun: true,
  },

  // 2. Shortage invoice, pending Amazon, 960 AED (carries a DSPT ref).
  shortagePending: {
    messageId: "sample-shortage-pending",
    from: "vendor-notifications@amazon.com",
    subject: "Shortage claim DSPT21868788319",
    receivedAt: "2026-06-02T08:00:00Z",
    bodyText:
      "Shortage invoice claim DSPT21868788319 is pending Amazon action. Amount: 960 AED.",
    dryRun: true,
  },

  // 3. PO summary with 0 unconfirmed POs → must NOT create an open action.
  poNoneUnconfirmed: {
    messageId: "sample-po-zero",
    from: "vendor-notifications@amazon.com",
    subject: "Purchase order summary",
    receivedAt: "2026-06-03T08:00:00Z",
    bodyText: "You have unconfirmed POs: count = 0. No action required at this time.",
    dryRun: true,
  },
};
