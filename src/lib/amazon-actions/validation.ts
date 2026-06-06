import { findOutcome } from "./mapping";
import type { ActionLogInput, Confidence } from "./types";

/**
 * Closure validation: returns an error message if the chosen outcome's required
 * reference / reason / ETA / qty is missing, or null when valid.
 */
export function validateActionLog(input: ActionLogInput): string | null {
  const option = findOutcome(input.actionType, input.outcome);
  if (!option) return "Unknown outcome for this action type.";

  if (option.managerOnly && !input.isManager) {
    return "This outcome can only be selected by a manager.";
  }

  const ref = (input.referenceValue ?? "").trim();
  const note = (input.reasonNote ?? "").trim();

  switch (option.requires) {
    case "reference": {
      const label = option.referenceType
        ? option.referenceType.toUpperCase()
        : "reference";
      if (!ref) return `A ${label} value is required for this outcome.`;
      break;
    }
    case "reason":
    case "note":
      if (!note) return "A note / reason is required for this outcome.";
      break;
    case "eta":
      if (!input.followUpDate) return "An ETA (follow-up date) is required.";
      break;
    case "qty_and_reason":
      if (!ref) return "A quantity is required.";
      if (!note) return "A reason is required.";
      break;
    case "recovered":
      if (input.recoveredAed == null || input.recoveredAed <= 0) {
        return "A recovered amount is required.";
      }
      break;
    case "recovered_and_note":
      if (input.recoveredAed == null || input.recoveredAed <= 0) {
        return "A recovered amount is required.";
      }
      if (!note) return "A note is required.";
      break;
    case "none":
      break;
  }

  return null;
}

/**
 * Confidence per the accuracy model:
 * High = invoice linked + reference attached + amount present;
 * Medium = partial data; Low = missing invoice + documentation.
 */
export function deriveConfidence(signals: {
  invoiceLinked: boolean;
  hasReference: boolean;
  hasAmount: boolean;
  resolved: boolean;
}): Confidence {
  if (signals.invoiceLinked && signals.hasReference && signals.hasAmount) {
    return "high";
  }
  if (signals.hasReference || signals.hasAmount || signals.resolved) {
    return "medium";
  }
  return "low";
}
