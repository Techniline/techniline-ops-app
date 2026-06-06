import type { AmazonAction } from "./types";

export interface ExposureBreakdown {
  returns: number;
  shortage: number;
  disputes: number;
  total: number;
}

export interface RecoveryBreakdown {
  raised: number;
  approved: number;
  recovered: number;
  pending: number;
  rejected: number;
}

export interface ActionSummary {
  openCount: number;
  overdueCount: number; // SLA red or escalated
  escalatedCount: number;
  missingDocCount: number;
  exposure: ExposureBreakdown;
  recovery: RecoveryBreakdown;
}

const amt = (n: number | null): number => n ?? 0;

/** Unresolved actions only contribute to open exposure. */
function isOpen(a: AmazonAction): boolean {
  return !a.resolved;
}

/**
 * Aggregate actions into the manager-facing summary. Definitions are kept simple
 * and adjustable:
 * - exposure: Σ amount of UNRESOLVED actions, bucketed by category
 * - recovery.raised: Σ amount of actions that have been actioned (waiting/resolved/closed)
 * - recovery.recovered: Σ recovered_aed
 * - recovery.rejected: Σ amount where outcome indicates rejection
 * - recovery.pending: Σ amount still waiting on Amazon
 * - recovery.approved: Σ amount of resolved actions with a recovered value
 */
export function computeActionSummary(actions: AmazonAction[]): ActionSummary {
  const exposure: ExposureBreakdown = { returns: 0, shortage: 0, disputes: 0, total: 0 };
  const recovery: RecoveryBreakdown = {
    raised: 0,
    approved: 0,
    recovered: 0,
    pending: 0,
    rejected: 0,
  };

  let openCount = 0;
  let overdueCount = 0;
  let escalatedCount = 0;
  let missingDocCount = 0;

  for (const a of actions) {
    if (isOpen(a)) {
      openCount += 1;
      const value = amt(a.amount);
      exposure.total += value;
      if (a.category === "return") exposure.returns += value;
      else if (a.category === "shortage") exposure.shortage += value;
      else if (a.category === "dispute") exposure.disputes += value;
    }

    if (a.sla === "red" || a.sla === "escalated") overdueCount += 1;
    if (a.sla === "escalated") escalatedCount += 1;
    if (a.missingDocumentation) missingDocCount += 1;

    const value = amt(a.amount);
    const outcome = a.latestOutcome ?? "";
    if (a.latestOutcome) recovery.raised += value;
    if (outcome.includes("reject")) recovery.rejected += value;
    if (a.workflowStatus === "waiting_amazon") recovery.pending += value;
    if (a.recovered != null) {
      recovery.recovered += a.recovered;
      recovery.approved += a.recovered;
    }
  }

  return {
    openCount,
    overdueCount,
    escalatedCount,
    missingDocCount,
    exposure,
    recovery,
  };
}

/** The Missing Documentation queue, oldest first. */
export function missingDocumentationQueue(
  actions: AmazonAction[]
): AmazonAction[] {
  return actions
    .filter((a) => a.missingDocumentation)
    .sort((a, b) => b.ageDays - a.ageDays);
}

/** Escalated (15+ day) actions, oldest first — for the manager view. */
export function escalatedQueue(actions: AmazonAction[]): AmazonAction[] {
  return actions
    .filter((a) => a.sla === "escalated" && !a.resolved)
    .sort((a, b) => b.ageDays - a.ageDays);
}
