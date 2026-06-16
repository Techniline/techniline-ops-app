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

/** One return row to log into marketplace_returns. */
export interface AmazonReturnRecord {
  channel: string; // marketplace_returns channel value
  orderId: string;
  sku: string | null;
  qty: number | null;
  receivedDate: string | null;
  prt: string | null;
  srt: string | null;
  tracking: string | null;
  note: string | null;
}

/** marketplace_returns channel for each sheet kind. */
const RETURN_CHANNEL: Record<AmazonDeliveryRecord["sheet"], string> = {
  easy_ship: "amazon_easy_ship",
  self_ship: "amazon_self_ship",
  amazon_df: "amazon_df",
};

const RETURN_STATUS_RE = /cancel|return|recd|received|w\/h|warehous/i;

/**
 * Extract the RETURN rows from the delivery workbook (one record per item-row
 * that has a return signal: a return date, a PRT/SRT number, or a status that
 * mentions cancel/return/received-in-warehouse). Each is channelled by its sheet.
 */
export function parseAmazonReturns(bytes: Uint8Array): AmazonReturnRecord[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const out: AmazonReturnRecord[] = [];

  for (const sheetName of wb.SheetNames) {
    const kind = sheetKind(sheetName);
    if (!kind) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

    // Locate header + column indices.
    let headerIdx = -1;
    const c: Record<string, number> = {};
    for (let i = 0; i < rows.length; i++) {
      const labels = (rows[i] ?? []).map(norm);
      if (labels.some((l) => l.includes("oder id") || l.includes("order id"))) {
        headerIdx = i;
        labels.forEach((label, idx) => {
          if (label.includes("oder id") || label.includes("order id")) c.orderId = idx;
          else if (label.includes("item code")) c.sku = idx;
          else if (label === "qta" || label === "qty") c.qty = idx;
          else if (label.includes("retun") || label.includes("return")) c.returnDate = idx;
          else if (label === "prt") c.prt = idx;
          else if (label === "srt") c.srt = idx;
          else if (label.includes("tracking")) c.tracking = idx;
          else if (label.includes("delivery status")) c.status = idx;
        });
        break;
      }
    }
    if (headerIdx < 0 || c.orderId == null) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const orderId = str(r[c.orderId]);
      if (!orderId) continue;

      // The "Amazon Retun date" column is free text: often an SRT number, a date,
      // and/or a note (e.g. "SRT/2600102 04.02.2026", "SRT/2600023", "11.03.2026 RCD").
      const retCell = c.returnDate != null ? str(r[c.returnDate]) : null;
      const prt = c.prt != null ? str(r[c.prt]) : null;
      let srt = c.srt != null ? str(r[c.srt]) : null;
      const status = c.status != null ? str(r[c.status]) : null;
      const statusIsReturn = !!status && RETURN_STATUS_RE.test(status);

      // A row is a return if any return signal is present.
      if (!retCell && !prt && !srt && !statusIsReturn) continue;

      // Pull a date + SRT number out of the free-text return cell (or status).
      const textSrc = retCell ?? status ?? "";
      const dm = textSrc.match(/(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})/);
      let received = dm ? isoDate(dm[1]) : c.returnDate != null ? isoDate(r[c.returnDate]) : null;
      if (!received && status) {
        const sm2 = status.match(/(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})/);
        if (sm2) received = isoDate(sm2[1]);
      }
      if (!srt && retCell) {
        const sm = retCell.match(/SRT[\s/_-]*\d+/i);
        if (sm) srt = sm[0].replace(/\s+/g, "").toUpperCase();
      }

      // Keep the raw return-cell text as a note when it carries more than a bare date.
      let note: string | null = statusIsReturn ? status : null;
      const bareDate = /^\s*\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\s*$/.test(retCell ?? "");
      if (retCell && !bareDate) note = note ? `${note}; ${retCell}` : retCell;

      out.push({
        channel: RETURN_CHANNEL[kind],
        orderId,
        sku: c.sku != null ? str(r[c.sku]) : null,
        qty: c.qty != null ? num(r[c.qty]) : null,
        receivedDate: received,
        prt,
        srt,
        tracking: c.tracking != null ? str(r[c.tracking]) : null,
        note,
      });
    }
  }

  return out;
}
