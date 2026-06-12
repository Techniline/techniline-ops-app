import * as XLSX from "xlsx";

export interface LedgerEntry {
  snum: string; // normalized S-number key, e.g. "S24155"
  invoiceNo: string | null;
  netAmount: number | null;
  customer: string | null;
  invDate: string | null;
  rawComment: string | null;
}

/** Pull the first S-number token (S + 4+ digits) out of a string. */
export function extractSNumber(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).match(/S\d{4,}/i);
  return m ? m[0].toUpperCase() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Parse a MusicMajlis "SIS Ledger" workbook. Locates the header row (the one
 * containing both "Inv No" and "Comment"), then reads each data row, keying on
 * the S-number found in the Comment column. Rows without an S-number are skipped.
 */
export function parseLedger(bytes: Uint8Array): LedgerEntry[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const out: LedgerEntry[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

    // Find the header row.
    let headerIdx = -1;
    let cols: Record<string, number> = {};
    for (let i = 0; i < rows.length; i++) {
      const r = (rows[i] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      if (r.includes("inv no") && r.includes("comment")) {
        headerIdx = i;
        const map: Record<string, number> = {};
        r.forEach((label, idx) => {
          if (label) map[label] = idx;
        });
        cols = map;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const cInv = cols["inv no"];
    const cComment = cols["comment"];
    const cNet = cols["net amount"] ?? cols["amount"];
    const cCustomer = cols["customer name"];
    const cDate = cols["inv date"];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const comment = str(r[cComment]);
      const snum = extractSNumber(comment) ?? extractSNumber(str(r[cInv]));
      if (!snum) continue;
      out.push({
        snum,
        invoiceNo: str(r[cInv]),
        netAmount: cNet != null ? num(r[cNet]) : null,
        customer: cCustomer != null ? str(r[cCustomer]) : null,
        invDate: cDate != null ? str(r[cDate]) : null,
        rawComment: comment,
      });
    }
  }

  // De-dupe by S-number, keeping the first (rows are usually newest-first).
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.snum) ? false : (seen.add(e.snum), true)));
}
