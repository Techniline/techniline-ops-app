// Shared display formatters for read-only finance views.

export function formatDate(value: string | null): string {
  return value ?? "—";
}

export function formatNumber(value: number | null): string {
  return value == null ? "—" : value.toLocaleString();
}

/** Format an AED amount, e.g. "AED 1,234.56". */
export function formatAED(value: number | null): string {
  if (value == null) return "—";
  return `AED ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
