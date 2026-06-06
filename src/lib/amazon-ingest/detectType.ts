import type { IngestPayload, IngestType } from "./types";

/** Maricel — the default operational assignee for inbound actions (id-based). */
export const DEFAULT_ASSIGNEE_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

/** Combined subject + body, for matching. */
export function combinedText(p: IngestPayload): string {
  return `${p.subject ?? ""}\n${p.bodyText ?? ""}`;
}

/** First capture group (or full match) of `re` against `text`. */
export function matchOne(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m) return null;
  return (m[1] ?? m[0]) ?? null;
}

/** Parse a money-ish string ("1,771", "AED 1,771.00") to a number. */
export function parseAed(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Find an amount that follows a label, e.g. amountNear(text, /approved amount/i). */
export function amountNear(text: string, label: RegExp): number | null {
  const re = new RegExp(
    `${label.source}[^0-9]{0,24}([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`,
    label.flags.includes("i") ? "i" : "i"
  );
  const m = text.match(re);
  return m ? parseAed(m[1]) : null;
}

/** All AED amounts in the text, in order of appearance. */
export function allAmounts(text: string): number[] {
  const re = /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*aed|aed\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseAed(m[1] ?? m[2] ?? null);
    if (n != null) out.push(n);
  }
  return out;
}

/** First standalone amount in the text (fallback when no label matches). */
export function firstAmount(text: string): number | null {
  const m = text.match(/([0-9][0-9,]{2,}(?:\.[0-9]{1,2})?)\s*aed|aed\s*([0-9][0-9,]{2,}(?:\.[0-9]{1,2})?)/i);
  if (!m) return null;
  return parseAed(m[1] ?? m[2] ?? null);
}

/**
 * Classify an inbound email. Order matters: shortage is checked before dispute
 * (a shortage email may carry a DSPT ref), and cancellation before vendor_po.
 */
export function detectType(payload: IngestPayload): IngestType {
  const text = combinedText(payload).toLowerCase();

  if (/remittance|payment advice|net\s*paid|remittance advice/.test(text)) {
    return "remittance";
  }
  if (/shortage/.test(text)) {
    return "shortage_claim";
  }
  if (/\bdspt\d+/.test(text) || /\bdispute\b|chargeback/.test(text)) {
    return "dispute_update";
  }
  if (/\breturn\b|return processed|\bvret\d+|\brma\b/.test(text)) {
    return "return_processed";
  }
  if (/cancel/.test(text) && /\bpo\b|purchase order/.test(text)) {
    return "po_cancellation";
  }
  if (/purchase order|unconfirmed|confirm|\bpo\b/.test(text)) {
    return "vendor_po";
  }
  return "unknown";
}
