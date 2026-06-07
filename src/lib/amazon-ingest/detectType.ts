import type { IngestPayload, IngestType } from "./types";

/** Maricel — the default operational assignee for inbound actions (id-based). */
export const DEFAULT_ASSIGNEE_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

/**
 * Convert an HTML email body to plain text so the regex parsers work on real
 * forwarded emails (Outlook/Power Automate send HTML). Plain text passes through
 * unchanged.
 */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return "";
  if (!/<[a-z!/]/i.test(input)) return input; // already plain text
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/tr|\/td|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Combined subject + body (body normalized from HTML), for matching. */
export function combinedText(p: IngestPayload): string {
  return `${p.subject ?? ""}\n${htmlToText(p.bodyText)}`;
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
 * (a shortage email may carry a DSPT ref). Keyword rules are kept tight because
 * real Amazon mail carries "dispute"/"confirm"/"po"/"return" in boilerplate that
 * otherwise mis-routes unrelated notices (see PARSER-GAP-REPORT.md, 2026-06-07).
 */
export function detectType(payload: IngestPayload): IngestType {
  const text = combinedText(payload).toLowerCase();

  if (/\bremittance\b|remittance advice/.test(text)) {
    return "remittance";
  }
  if (/shortage/.test(text)) {
    return "shortage_claim";
  }
  // Real disputes carry a DSPT id; the bare word "dispute" appears in PO and
  // payment boilerplate, so don't classify on it alone.
  if (/\bdspt\d+/.test(text) || /chargeback/.test(text)) {
    return "dispute_update";
  }
  // Returns: require a return id / PRT / SRT / RMA / explicit "vendor return",
  // not the bare word "return" (which shows up in unrelated payment notices).
  if (/\bvret\d+|\brma\b|\bprt\b|\bsrt\b|vendor return|return processed|return id/.test(text)) {
    return "return_processed";
  }
  // Delivery/inbound appointment notifications ("Appointment Confirmed/Deleted",
  // reschedules) are not POs even though their bodies carry confirm/cancel/po
  // boilerplate. Exclude before the PO rules — unless it's a real Amazon.ae PO.
  if (/\bappointment\b/.test(text) && !/amazon\.ae\s+po\b/.test(text)) {
    return "unknown";
  }
  if (/cancel/.test(text) && /amazon\.ae\s+po\b|purchase order|\bpo\(s\)|\bpo\b/.test(text)) {
    return "po_cancellation";
  }
  // vendor_po without the bare word "confirm" (which matched "Appointment
  // Confirmed"); keep "unconfirmed" and explicit PO references.
  if (/purchase order|unconfirmed|amazon\.ae\s+po\b|\bpo\(s\)|\bpo\b/.test(text)) {
    return "vendor_po";
  }
  return "unknown";
}
