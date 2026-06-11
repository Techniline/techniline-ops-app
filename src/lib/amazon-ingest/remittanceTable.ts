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

// A real invoice number is short and alphanumeric, e.g. "6000141979", "WS2601079".
function looksLikeInvoice(s: string): boolean {
  return /^[A-Za-z]{0,4}\d{4,}$/.test(s) && s.length <= 24;
}

/** Parse the remittance email HTML (or plain text fallback) into header + lines. */
export function parseRemittanceTable(html: string | null | undefined): RemittanceParsed {
  const out: RemittanceParsed = { paymentNumber: null, paymentAmount: null, paymentDate: null, lines: [] };
  if (!html) return out;

  // Header fields (from the small key/value table).
  const num = html.match(/Payment\s*number:\s*<\/b>\s*<\/td>\s*<td[^>]*>\s*([0-9]{6,})/i)
    ?? html.match(/Payment\s*number[:\s]*([0-9]{6,})/i);
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
    if (rawCells.length !== 6) continue;
    const invoiceNumber = stripTags(rawCells[0]);
    const invoiceDate = toIsoDate(stripTags(rawCells[1]));
    if (!looksLikeInvoice(invoiceNumber) || !invoiceDate) continue; // not an invoice row
    const rawPaid = rawCells[4];
    out.lines.push({
      invoiceNumber,
      invoiceDate,
      description: stripTags(rawCells[2]),
      amountPaid: parseAmount(stripTags(rawPaid)),
      amountRemaining: parseAmount(stripTags(rawCells[5])),
      partial: /\*/.test(rawPaid),
    });
  }

  // Fallback: Graph often returns the body as PLAIN TEXT (tab/space-separated),
  // where each invoice row looks like:
  //   6000141979   05-JUN-2026   Co-op-...   *(448.37)   (11,398.37)
  // Detect a row by: starts with an invoice number, contains a DD-MON-YYYY date,
  // and has amount tokens. Robust to tabs or runs of spaces.
  if (out.lines.length === 0) {
    const amountRe = /\*?\(?-?[\d,]+\.\d{2}\)?/g;
    for (const rawLine of html.split(/\r?\n/)) {
      const line = rawLine.replace(/&nbsp;/gi, " ").trim();
      if (!line) continue;
      const dateMatch = line.match(/\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/);
      if (!dateMatch || dateMatch.index == null) continue;
      const firstTok = line.split(/\s+/)[0];
      if (!looksLikeInvoice(firstTok)) continue;
      const invoiceDate = toIsoDate(dateMatch[1]);
      if (!invoiceDate) continue;
      const amts = line.match(amountRe) ?? [];
      const firstAmt = amts[0];
      if (!firstAmt) continue;
      const amountPaid = parseAmount(firstAmt);
      const amountRemaining = amts.length > 1 ? parseAmount(amts[amts.length - 1] ?? "") : null;
      // Description = text between the date and the first amount token.
      const afterDate = line.slice(dateMatch.index + dateMatch[1].length);
      const firstAmtIdx = afterDate.search(amountRe);
      const description = (firstAmtIdx > 0 ? afterDate.slice(0, firstAmtIdx) : "").replace(/\s+/g, " ").trim();
      out.lines.push({
        invoiceNumber: firstTok,
        invoiceDate,
        description,
        amountPaid,
        amountRemaining,
        partial: /\*/.test(firstAmt),
      });
    }
  }

  return out;
}
