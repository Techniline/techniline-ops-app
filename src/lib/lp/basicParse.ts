import type { LpDraft, LpLineItem } from "./parseTypes";

/** Parse a number that may carry thousands separators (e.g. "1,238.25"). */
function num(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Free, dependency-free parser (no AI) for the Techniline LPO ("PURCHASE ORDER")
 * layout as extracted by unpdf. Captures the header (LP no, date, vendor, TRNs,
 * totals, terms) and makes a best-effort pass at the line-item table.
 *
 * The table extracts with columns glued/re-ordered as:
 *   <Sr> <Amount><Qty> <Price><ModelNo><Description><Brand> <DiscAmt>
 * e.g. "1 258.751.00 258.75XV1R Portable Stereo RecorderXvive 0.00".
 *
 * It is intentionally heuristic — the human Verify step corrects anything it
 * gets wrong, and it won't cover every vendor layout. Set ANTHROPIC_API_KEY to
 * upgrade to AI extraction (any layout; see parseLp.ts).
 */
export function parseLpBasic(text: string): LpDraft {
  const lpNumber = text.match(/\b(LPO\/\d{3,10})/)?.[1] ?? null;

  // First DD/MM/YYYY on the document is the LP date.
  const dateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const lpDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`
    : null;

  // Two 15-digit TRNs: [0] = consigner (vendor), [1] = consignee (Techniline).
  const trns = [...text.matchAll(/\b(\d{15})\b/g)].map((m) => m[1]);
  const vendorTrn = trns[0] ?? null;
  const consigneeTrn = trns[1] ?? null;

  // Vendor name sits right after the consigner TRN, up to the address marker.
  const vendorName =
    text
      .match(/\b\d{15}\s+(.+?)\s+(?:WH\b|Office\b|Shop\b|Bldg\b|Building\b|P\.?\s?O\b|\+\d)/)?.[1]
      ?.trim() ?? null;

  const amountBeforeVat = num(text.match(/Total Before VAT\s*:?\s*([\d,]+\.\d{2})/)?.[1]);
  const vatAmount = num(text.match(/VAT\s+([\d,]+\.\d{2})/)?.[1]);
  // The amount-in-words line ends with the gross total (incl. VAT).
  const netAmount = num(text.match(/Only\s+([\d,]+\.\d{2})/)?.[1]);
  const terms = text.match(/(\d+\s+Days?\s+Credit)/i)?.[1]?.trim() ?? null;

  const lineItems: LpLineItem[] = [];
  const seen = new Set<string>();

  // <Sr> <Amount><Qty> <Price><blob> <Disc>, bounded by the next row / totals.
  const re =
    /(\d{1,3})\s+([\d,]+\.\d{2})(\d+\.\d{2})\s+([\d,]+\.\d{2})(.+?)\s+(\d+\.\d{2})(?=\s+\d{1,3}\s+[\d,]+\.\d{2}\d+\.\d{2}|\s+Document\b|\s+AED\b|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lineNumber = Number(m[1]);
    const amount = num(m[2]);
    const qty = num(m[3]);
    const unitPrice = num(m[4]);
    const blob = m[5].trim();
    const discAmount = num(m[6]);

    // Model No = first token; brand = trailing Capitalised or ALL-CAPS word.
    const space = blob.indexOf(" ");
    const modelNo = (space === -1 ? blob : blob.slice(0, space)).trim();
    let rest = space === -1 ? "" : blob.slice(space + 1).trim();
    let brand: string | null = null;
    const camel = rest.match(/([A-Z][a-z]+)$/);
    const caps = rest.match(/\s([A-Z]{2,})$/);
    if (camel) {
      brand = camel[1];
      rest = rest.slice(0, rest.length - brand.length).trim();
    } else if (caps) {
      brand = caps[1];
      rest = rest.slice(0, rest.length - brand.length).trim();
    }

    if (modelNo === "" || qty === null) continue;
    const key = `${modelNo}|${qty}|${unitPrice}`;
    if (seen.has(key)) continue; // the table repeats per page
    seen.add(key);

    lineItems.push({
      lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
      brand,
      modelNo,
      description: rest.slice(0, 300) || null,
      qty,
      unitPrice,
      amount,
      discAmount: discAmount ?? 0,
    });
  }

  return {
    lpNumber,
    lpDate,
    vendorName,
    vendorTrn,
    consigneeTrn,
    qtnRef: null,
    amountBeforeVat,
    vatAmount,
    netAmount,
    terms,
    lineItems,
  };
}
