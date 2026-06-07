import type { InvoiceDraft, InvoiceLineItem } from "./invoiceTypes";

/**
 * Free, dependency-free invoice parser (no AI). Tuned to the Cocoblu / Microless
 * "TAX INVOICE" layout as extracted by unpdf. Captures the invoice number/date
 * reliably and makes a best-effort pass at line items (SKU, qty, unit cost).
 *
 * It is intentionally heuristic — the human Verify step corrects anything it
 * gets wrong. Set ANTHROPIC_API_KEY to upgrade to AI extraction (see
 * parseInvoice.ts).
 */
export function parseInvoiceBasic(text: string): InvoiceDraft {
  const invoiceNumber = text.match(/\b([A-Z]{1,4}\/\d{4,})\b/)?.[1] ?? null;

  const dateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const invoiceDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`
    : null;

  // Per item the text runs: <price> <disc><qty><MODEL+Brand><sr> <description> <amount>
  // e.g. "4,999.00 0.001.00STRATACLUBKITAlesis1 Four-piece … Module 4,999.00"
  const itemRe =
    /([\d,]+\.\d{2})\s+(\d+\.\d{2})(\d+\.\d{2})([A-Za-z0-9 ]+?)(\d{1,3})\s+(.+?)\s+([\d,]+\.\d{2})(?=\s)/g;

  const seen = new Set<string>();
  const lineItems: InvoiceLineItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(text)) !== null) {
    const unitCost = Number(m[1].replace(/,/g, ""));
    const qty = Number(m[3]);
    const blob = m[4].trim();
    const description = m[6].trim();

    // Strip a trailing brand (e.g. "Alesis", "Helicon"), then a leftover "TC"
    // from the "TC Helicon" brand, then remove internal spaces.
    let sku = blob.replace(/\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/, "");
    if (/helicon/i.test(blob)) sku = sku.replace(/TC\s*$/, "");
    sku = sku.replace(/\s+/g, "").trim();

    if (sku === "" || !Number.isFinite(qty)) continue;

    const key = `${sku}|${qty}|${unitCost}`;
    if (seen.has(key)) continue; // the invoice text repeats per page
    seen.add(key);

    lineItems.push({
      sku,
      description: description.slice(0, 200) || null,
      brand: null,
      qty: Number.isFinite(qty) ? qty : null,
      unitCost: Number.isFinite(unitCost) ? unitCost : null,
    });
  }

  return { invoiceNumber, invoiceDate, suppliedDate: null, lineItems };
}
