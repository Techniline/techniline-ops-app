import * as XLSX from "xlsx";

/** One Amazon order → ERP invoice mapping from the SIS Ledger export. */
export interface AmazonInvoiceRecord {
  orderId: string; // Amazon order id (from the Comment column)
  invoiceNo: string; // ERP/TLE invoice number (Inv No column)
  netAmount: number | null;
}

export interface AmazonInvoiceParse {
  records: AmazonInvoiceRecord[]; // de-duped per order id (first invoice wins)
  rows: number; // data rows with both an order id and an invoice number
}

const ORDER_RE = /\b\d{3}-\d{7}-\d{7}\b/; // Amazon order id
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) && v.trim() !== "" ? n : null; }
  return null;
}

/**
 * Parse the SIS Ledger workbook (ERP export of Amazon invoices). The header row
 * has "Inv No" + "Comment"; the Comment holds the Amazon order id and Inv No the
 * ERP invoice number. Rows without both are skipped.
 */
export function parseAmazonInvoices(bytes: Uint8Array): AmazonInvoiceParse {
  const wb = XLSX.read(bytes, { type: "array" });
  const out: AmazonInvoiceRecord[] = [];
  let rows = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

    let headerIdx = -1;
    const c: Record<string, number> = {};
    for (let i = 0; i < grid.length; i++) {
      const labels = (grid[i] ?? []).map(norm);
      if (labels.includes("inv no") && labels.includes("comment")) {
        headerIdx = i;
        labels.forEach((l, idx) => {
          if (l === "inv no") c.inv = idx;
          else if (l === "comment") c.comment = idx;
          else if (l === "net amount") c.net = idx;
        });
        break;
      }
    }
    if (headerIdx < 0 || c.inv == null || c.comment == null) continue;

    for (let i = headerIdx + 1; i < grid.length; i++) {
      const r = grid[i] ?? [];
      const comment = String(r[c.comment] ?? "").trim();
      const m = comment.match(ORDER_RE);
      const invoiceNo = String(r[c.inv] ?? "").trim();
      if (!m || !invoiceNo) continue;
      rows += 1;
      out.push({ orderId: m[0], invoiceNo, netAmount: c.net != null ? num(r[c.net]) : null });
    }
  }

  const seen = new Set<string>();
  const records = out.filter((r) => (seen.has(r.orderId) ? false : (seen.add(r.orderId), true)));
  return { records, rows };
}
