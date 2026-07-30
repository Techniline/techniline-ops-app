/**
 * Parse an Amazon Remittance Advice email (HTML) into the payment header + the
 * invoice line table. The email is a clean <table>: each data row has 6 cells —
 * Invoice Number, Invoice Date, Invoice Description, Discount Taken, Amount Paid,
 * Amount Remaining. Amounts in parentheses are negative; a leading "*" means the
 * invoice was partially paid / previously deducted.
 */

export interface RemittanceLineParsed {
  invoiceNumber: string;
  invoiceDate: string | null; // ISO yyyy-mm-dd
  description: string;
  vendorCode: string | null;
  transactionType: string | null;
  invoiceAmount: number | null;
  termsDiscountTaken: number | null;
  amountPaid: number | null; // signed (negative = deduction)
  amountRemaining: number | null; // signed
  partial: boolean; // had a leading "*"
}

export interface RemittanceParsed {
  paymentNumber: string | null;
  paymentAmount: number | null;
  paymentDate: string | null; // ISO
  lines: RemittanceLineParsed[];
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "05-JUN-2026" → "2026-06-05" (null if unrecognised). */
function toIsoDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

/** "*(448.37)" → -448.37 ; "99.23" → 99.23 ; "(11,398.37)" → -11398.37 ; "" → null */
function parseAmount(raw: string): number | null {
  let t = raw.replace(/&nbsp;/gi, "").replace(/[*\s,]/g, "").trim();
  if (t === "") return null;
  const neg = /^\(.*\)$/.test(t);
  t = t.replace(/[()]/g, "");
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// An invoice / claim reference: alphanumeric, may have leading AND trailing
// letters (e.g. "6000141979", "WS2601079", "7500582589R1", "WS2502533SCRSC").
// Must contain at least 4 digits; the valid-date check on the next cell is the
// primary guard against non-invoice rows.
function looksLikeInvoice(s: string): boolean {
  return /^[A-Za-z0-9-]{5,30}$/.test(s) && (s.match(/\d/g)?.length ?? 0) >= 4;
}

/** Parse the remittance email HTML (or plain text fallback) into header + lines. */
export function parseRemittanceTable(html: string | null | undefined): RemittanceParsed {
  const out: RemittanceParsed = { paymentNumber: null, paymentAmount: null, paymentDate: null, lines: [] };
  if (!html) return out;

  // Header fields (from the small key/value table).
  // Cap at 13 digits — Amazon payment numbers are 9 digits; 14-15 digit numbers are Return IDs.
  const num = html.match(/Payment\s*number:\s*<\/b>\s*<\/td>\s*<td[^>]*>\s*([0-9]{6,13})/i)
    ?? html.match(/Payment\s*number[:\s]*([0-9]{6,13})/i);
  if (num) out.paymentNumber = num[1];

  const amt = html.match(/Payment\s*amount:\s*<\/b>\s*<\/td>\s*<td[^>]*>\s*([()*\d.,\-]+)/i);
  if (amt) out.paymentAmount = parseAmount(amt[1]);

  const date = html.match(/Payment\s*date:\s*<\/b>\s*<\/td>\s*<td[^>]*>\s*([0-9]{1,2}-[A-Za-z]{3}-\d{4})/i);
  if (date) out.paymentDate = toIsoDate(date[1]);

  // Find invoice rows anywhere in the body. A real invoice line is a 6-cell row
  // whose first cell looks like an invoice number AND whose second cell is a
  // valid DD-MON-YYYY date. That uniquely identifies the invoice table rows and
  // rejects the forwarded-email wrapper rows — no fragile header anchoring.
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  for (const row of rows) {
    const rawCells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    // Amazon vendor emails now use a 9-column table; older/seller emails use 6.
    if (rawCells.length === 9) {
      const invoiceNumber = stripTags(rawCells[0]);
      const invoiceDate = toIsoDate(stripTags(rawCells[1]));
      if (!looksLikeInvoice(invoiceNumber) || !invoiceDate) continue;
      const rawPaid = rawCells[7];
      out.lines.push({
        invoiceNumber,
        invoiceDate,
        description: stripTags(rawCells[2]),
        vendorCode: stripTags(rawCells[3]) || null,
        transactionType: stripTags(rawCells[4]) || null,
        invoiceAmount: parseAmount(stripTags(rawCells[5])),
        termsDiscountTaken: parseAmount(stripTags(rawCells[6])),
        amountPaid: parseAmount(stripTags(rawPaid)),
        amountRemaining: parseAmount(stripTags(rawCells[8])),
        partial: /\*/.test(rawPaid),
      });
    } else if (rawCells.length === 6) {
      const invoiceNumber = stripTags(rawCells[0]);
      const invoiceDate = toIsoDate(stripTags(rawCells[1]));
      if (!looksLikeInvoice(invoiceNumber) || !invoiceDate) continue;
      const rawPaid = rawCells[4];
      out.lines.push({
        invoiceNumber,
        invoiceDate,
        description: stripTags(rawCells[2]),
        vendorCode: null,
        transactionType: null,
        invoiceAmount: null,
        termsDiscountTaken: parseAmount(stripTags(rawCells[3])),
        amountPaid: parseAmount(stripTags(rawPaid)),
        amountRemaining: parseAmount(stripTags(rawCells[5])),
        partial: /\*/.test(rawPaid),
      });
    }
  }

  // Fallback: Graph usually returns the body as PLAIN TEXT. Capture EVERY line of
  // the invoice table — anchor on the header row ("Amount Paid … Amount Remaining")
  // and read every data line until the table's footer note. No per-row format
  // filtering, so nothing is skipped; the last two amounts on a line are
  // Amount Paid + Amount Remaining (so a "Discount Taken" value can't shift them).
  if (out.lines.length === 0) {
    const amountRe = /\*?\(?-?[\d,]+\.\d{2}\)?/g;
    const allLines = html.split(/\r?\n/).map((l) => l.replace(/&nbsp;/gi, " ").trim());
    const startIdx = allLines.findIndex((l) => /amount\s*paid/i.test(l) && /amount\s*remaining/i.test(l));
    const scan = startIdx >= 0 ? allLines.slice(startIdx + 1) : allLines;
    for (const line of scan) {
      if (!line) continue;
      // Stop at the table footer note (the asterisk legend / totals).
      if (/please\s*note|^total\b/i.test(line)) break;
      const amts = line.match(amountRe);
      if (!amts || amts.length === 0) continue; // not a data row (no money on it)
      const firstTok = line.split(/\s+/)[0];
      // Skip the header row and any obvious non-row; a data row's first token has digits.
      if (!firstTok || !/\d/.test(firstTok)) continue;
      const dateMatch = line.match(/\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/);
      const paidTok = amts.length >= 2 ? amts[amts.length - 2]! : amts[0]!;
      const remainTok = amts[amts.length - 1]!;
      // Description = text between the first token (and date if present) and the first amount.
      const firstAmtIdx = line.search(amountRe);
      let desc = firstAmtIdx > 0 ? line.slice(firstTok.length, firstAmtIdx) : "";
      if (dateMatch?.[1]) desc = desc.replace(dateMatch[1], "");
      out.lines.push({
        invoiceNumber: firstTok,
        invoiceDate: dateMatch ? toIsoDate(dateMatch[1]) : null,
        description: desc.replace(/\s+/g, " ").trim(),
        vendorCode: null,
        transactionType: null,
        invoiceAmount: null,
        termsDiscountTaken: null,
        amountPaid: parseAmount(paidTok),
        amountRemaining: parseAmount(remainTok),
        partial: /\*/.test(paidTok),
      });
    }
  }

  return out;
}
