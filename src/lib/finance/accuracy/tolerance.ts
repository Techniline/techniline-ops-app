/**
 * Allowed absolute tolerance for comparing two amounts:
 * the greater of AED 1.00 or 0.5% of the expected value.
 */
export function tolerance(expected: number): number {
  return Math.max(1, Math.abs(expected) * 0.005);
}

/** True when `actual` is within {@link tolerance} of `expected`. */
export function withinTolerance(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) <= tolerance(expected);
}
