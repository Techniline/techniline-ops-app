/**
 * Finance accuracy analysis is scoped to 2025 onward. This filters the
 * *analysis only* — it never deletes or modifies any data.
 */
export const SCOPE_START = "2025-01-01";

/**
 * True when an ISO date / timestamp string falls on or after {@link SCOPE_START}.
 * ISO strings (YYYY-MM-DD and full timestamptz) compare lexicographically, so a
 * plain string comparison is correct here.
 */
export function inScope(date: string | null | undefined): boolean {
  if (!date) return false;
  return date >= SCOPE_START;
}

/** Scope test using the best available date, with a fallback field. */
export function effectiveInScope(
  primary: string | null | undefined,
  fallback: string | null | undefined
): boolean {
  return inScope(primary ?? fallback ?? null);
}
