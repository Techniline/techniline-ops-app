import * as XLSX from "xlsx";

/** One order's worth of operational delivery/return info pulled from the
 *  "Amazon Seller Delivery List" workbook (Easy Ship / Amazon DF / Self Ship). */
export interface AmazonDeliveryRecord {
  orderId: string;
  sheet: "easy_ship" | "amazon_df" | "self_ship";
  deliveryStatus: string | null;
  deliveryDate: string | null; // ISO yyyy-mm-dd
  returnDate: string | null; // ISO yyyy-mm-dd
  prt: string | null;
  srt: string | null;
  trackingNo: string | null;
  deliveryCharge: number | null;
  deliveryAddress: string | null;
}

export interface AmazonDeliveryParse {
  records: AmazonDeliveryRecord[]; // de-duped per order id (merged across rows)
  rowsBySheet: Record<string, number>; // raw data rows seen per sheet
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

/** Parse a cell into an ISO date. Handles Excel serials (e.g. 46266) and
 *  textual dd.mm.yyyy / dd-mm-yyyy / dd/mm/yyyy. Returns null if unparseable. */
function isoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  // Excel serial date number.
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) {
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${d.y}-${mm}-${dd}`;
    }
    return null;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = (Number(yy) >= 70 ? "19" : "20") + yy;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Classify a sheet name into our three fulfillment buckets. */
function sheetKind(name: string): AmazonDeliveryRecord["sheet"] | null {
  const n = norm(name);
  if (n.includes("easy")) return "easy_ship";
  if (n.includes("self")) return "self_ship";
  if (n.includes("df") || n.includes("flex")) return "amazon_df";
  return null;
}

/** Column-header aliases → our field. Matched after normalising the header. */
const COL: Record<string, keyof AmazonDeliveryRecord | "deliveryDate2"> = {
  "oder id": "orderId",
  "order id": "orderId",
  "amazon oder id": "orderId",
  "amazon order id": "orderId",
  "delivery date": "deliveryDate",
  "delivery status": "deliveryStatus",
  "amazon retun date": "returnDate",
  "amazon return date": "returnDate",
  "return date": "returnDate",
  prt: "prt",
  srt: "srt",
  "tracking no": "trackingNo",
  tracking: "trackingNo",
  "delivery chgs amount": "deliveryCharge",
  "delivery charges": "deliveryCharge",
  "delivery chgs": "deliveryCharge",
  "delivery summary": "deliveryAddress",
  address: "deliveryAddress",
};

/**
 * Parse the Amazon Seller Delivery List workbook. Reads each known sheet, maps
 * its columns, and merges rows by Amazon order id (one record per order, taking
 * the first non-empty value for each field). Rows without an order id are skipped.
 */
export function parseAmazonDelivery(bytes: Uint8Array): AmazonDeliveryParse {
  const wb = XLSX.read(bytes, { type: "array" });
  const byOrder = new Map<string, AmazonDeliveryRecord>();
  const rowsBySheet: Record<string, number> = {};

  for (const sheetName of wb.SheetNames) {
    const kind = sheetKind(sheetName);
    if (!kind) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

    // Locate the header row: the first row that contains an order-id column.
    let headerIdx = -1;
    const cols: Record<number, keyof AmazonDeliveryRecord> = {};
    for (let i = 0; i < rows.length; i++) {
      const labels = (rows[i] ?? []).map(norm);
      if (labels.some((l) => l.includes("oder id") || l.includes("order id"))) {
        headerIdx = i;
        labels.forEach((label, idx) => {
          const field = COL[label];
          if (field && field !== "deliveryDate2") cols[idx] = field;
        });
        break;
      }
    }
    if (headerIdx < 0) continue;

    let count = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      // Read the order id first.
      let orderId: string | null = null;
      for (const [idxStr, field] of Object.entries(cols)) {
        if (field === "orderId") orderId = str(r[Number(idxStr)]);
      }
      if (!orderId) continue;
      count += 1;

      const rec: AmazonDeliveryRecord =
        byOrder.get(orderId) ?? {
          orderId,
          sheet: kind,
          deliveryStatus: null,
          deliveryDate: null,
          returnDate: null,
          prt: null,
          srt: null,
          trackingNo: null,
          deliveryCharge: null,
          deliveryAddress: null,
        };

      for (const [idxStr, field] of Object.entries(cols)) {
        const cell = r[Number(idxStr)];
        switch (field) {
          case "deliveryDate":
            rec.deliveryDate ??= isoDate(cell);
            break;
          case "returnDate":
            rec.returnDate ??= isoDate(cell);
            break;
          case "deliveryCharge":
            rec.deliveryCharge ??= num(cell);
            break;
          case "deliveryStatus":
            rec.deliveryStatus ??= str(cell);
            break;
          case "prt":
            rec.prt ??= str(cell);
            break;
          case "srt":
            rec.srt ??= str(cell);
            break;
          case "trackingNo":
            rec.trackingNo ??= str(cell);
            break;
          case "deliveryAddress":
            rec.deliveryAddress ??= str(cell);
            break;
          default:
            break;
        }
      }
      byOrder.set(orderId, rec);
    }
    rowsBySheet[kind] = (rowsBySheet[kind] ?? 0) + count;
  }

  return { records: [...byOrder.values()], rowsBySheet };
}
