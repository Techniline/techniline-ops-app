import { normalizeRef } from "@/lib/finance/accuracy";

import type { ActionLog } from "./types";

/**
 * Build a frequency index of normalized reference values already used across
 * existing action logs. Used to warn (not block) on reused SRT/PRT/dispute refs.
 */
export function buildReferenceIndex(logs: ActionLog[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const log of logs) {
    if (!log.reference_value) continue;
    const key = normalizeRef(log.reference_value);
    if (!key) continue;
    index.set(key, (index.get(key) ?? 0) + 1);
  }
  return index;
}

/**
 * True when `value` already appears in the index. When `selfCounted` is true the
 * value is assumed to include itself once, so a duplicate means count > 1.
 */
export function isDuplicateReference(
  value: string | null | undefined,
  index: Map<string, number>,
  selfCounted = false
): boolean {
  if (!value) return false;
  const key = normalizeRef(value);
  if (!key) return false;
  const count = index.get(key) ?? 0;
  return selfCounted ? count > 1 : count > 0;
}
