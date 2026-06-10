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
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
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

  // Invoice rows: any <tr> with exactly the 6 invoice columns. The header row's
  // first cell is "Invoice Number" — skip it.
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length !== 6) continue;
    const invoiceNumber = stripTags(cells[0]);
    if (!invoiceNumber || /^invoice\s*number$/i.test(invoiceNumber)) continue; // header / blank
    const rawPaid = cells[4];
    out.lines.push({
      invoiceNumber,
      invoiceDate: toIsoDate(stripTags(cells[1])),
      description: stripTags(cells[2]),
      amountPaid: parseAmount(stripTags(rawPaid)),
      amountRemaining: parseAmount(stripTags(cells[5])),
      partial: /\*/.test(rawPaid),
    });
  }

  return out;
}
