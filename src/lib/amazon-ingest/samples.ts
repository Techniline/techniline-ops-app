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

  // 1b. Resolved dispute with TWO unlabeled AED amounts (claim + approved).
  //     Expected: invoice_amount=1771, approvedAmount=1771.
  disputeResolvedTwoAmounts: {
    messageId: "test-dspt-20065219423",
    threadId: "manual-test",
    from: "Amazon",
    subject: "DSPT20065219423 Resolved",
    receivedAt: "2026-06-07T00:00:00Z",
    bodyText:
      "DSPT20065219423 AE Vendor returns Shipment - Have not received this return 4/6/2026 Resolved 1,771.00 AED 1,771.00 AED",
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

  // 3b. "to confirm 0 No action needed" → no operations.
  poZeroToConfirm: {
    messageId: "sample-po-confirm-zero",
    from: "Amazon",
    subject: "You have new purchase orders to confirm",
    receivedAt: "2026-06-07T00:00:00Z",
    bodyText: "You have new purchase orders to confirm 0 No action needed",
    dryRun: true,
  },

  // 3c. "No action needed" with no count → no operations.
  poNoActionNeeded: {
    messageId: "sample-po-noaction",
    from: "Amazon",
    subject: "Purchase orders to confirm",
    receivedAt: "2026-06-07T00:00:00Z",
    bodyText: "You have new purchase orders to confirm. No action needed.",
    dryRun: true,
  },

  // 3d. Explicit PO number → creates an action.
  poWithNumber: {
    messageId: "sample-po-number",
    from: "Amazon",
    subject: "Confirm purchase order",
    receivedAt: "2026-06-07T00:00:00Z",
    bodyText: "Please confirm purchase order 12345678 by end of day.",
    dryRun: true,
  },

  // 3e. Positive unconfirmed count → creates an action.
  poPositiveCount: {
    messageId: "sample-po-positive",
    from: "Amazon",
    subject: "You have new purchase orders to confirm",
    receivedAt: "2026-06-07T00:00:00Z",
    bodyText: "You have 5 new purchase orders to confirm.",
    dryRun: true,
  },
};
