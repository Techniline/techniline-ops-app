import type { InvoiceDraft, InvoiceLineItem } from "./invoiceTypes";

/**
 * Free, dependency-free invoice parser (no AI). Handles the two supplier
 * "TAX INVOICE" layouts seen so far (Microless/Cocoblu and the Dulam/Nevin
 * style) as extracted by unpdf. Captures invoice number/date and makes a
 * best-effort pass at line items (SKU, qty, unit cost).
 *
 * It is intentionally heuristic — the human Verify step corrects anything it
 * gets wrong, and it won't cover every vendor layout. Set ANTHROPIC_API_KEY to
 * upgrade to AI extraction (any format; see parseInvoice.ts).
 */
export function parseInvoiceBasic(text: string): InvoiceDraft {
  // No trailing \b — invoice numbers are often glued to the next word in the
  // extracted text (e.g. "INV/001995Voucher"). Bound the digits instead.
  const invoiceNumber = text.match(/\b([A-Z]{2,4}\/\d{3,10})/)?.[1] ?? null;

  // Date may use slashes or dashes: DD/MM/YYYY or DD-MM-YYYY.
  const dateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  const invoiceDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`
    : null;

  const seen = new Set<string>();
  const lineItems: InvoiceLineItem[] = [];
  const push = (sku: string, description: string, qty: number, unitCost: number) => {
    if (sku === "" || !Number.isFinite(qty)) return;
    const key = `${sku}|${qty}|${unitCost}`;
    if (seen.has(key)) return; // the invoice text repeats per page
    seen.add(key);
    lineItems.push({
      sku,
      description: description.slice(0, 200) || null,
      brand: null,
      qty,
      unitCost: Number.isFinite(unitCost) ? unitCost : null,
    });
  };

  // Layout A (Microless): <price> <disc><qty><MODEL+Brand><sr> <description> <amount>
  // e.g. "4,999.00 0.001.00STRATACLUBKITAlesis1 Four-piece … Module 4,999.00"
  const reA = /([\d,]+\.\d{2})\s+(\d+\.\d{2})(\d+\.\d{2})([A-Za-z0-9 ]+?)(\d{1,3})\s+(.+?)\s+([\d,]+\.\d{2})(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(text)) !== null) {
    const unitCost = Number(m[1].replace(/,/g, ""));
    const qty = Number(m[3]);
    const blob = m[4].trim();
    let sku = blob.replace(/\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/, "");
    if (/helicon/i.test(blob)) sku = sku.replace(/TC\s*$/, "");
    sku = sku.replace(/\s+/g, "").trim();
    push(sku, m[6].trim(), qty, unitCost);
  }

  // Layout B (Dulam/Nevin): <sr> <Model Description> <qty> <price><BRAND> <amount>
  // e.g. "1 APOLLOTWINXDUO 10x6 Thunderbolt … 1 3,300.30UNIVERSAL AUDIO 3,300.30"
  if (lineItems.length === 0) {
    const reB = /(?:^|\s)(\d{1,3})\s+([A-Za-z0-9][\w +./-]*?)\s+(\d+)\s+([\d,]+\.\d{2})([A-Z][A-Za-z &]+?)\s+([\d,]+\.\d{2})(?=\s|$)/g;
    while ((m = reB.exec(text)) !== null) {
      const modelDesc = m[2].trim();
      const space = modelDesc.indexOf(" ");
      const sku = (space === -1 ? modelDesc : modelDesc.slice(0, space)).trim();
      const description = space === -1 ? "" : modelDesc.slice(space + 1).trim();
      push(sku, description, Number(m[3]), Number(m[4].replace(/,/g, "")));
    }
  }

  return { invoiceNumber, invoiceDate, suppliedDate: null, lineItems };
}
