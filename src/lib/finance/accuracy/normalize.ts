/**
 * Normalize a reference (invoice number, payment ref, etc.) for tolerant
 * matching: trim, uppercase, and strip everything that isn't A–Z / 0–9.
 * Null/undefined become "".
 */
export function normalizeRef(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
