import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function getUser(request: Request): Promise<{ id: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

function svcClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

const COMPANY_INFO: Record<string, {
  name: string;
  address: string[];
  tel: string;
  fax: string;
  email: string;
  web: string;
  addressBar: string;
  logo: string;
}> = {
  techniline: {
    name: "Techniline Electronic L.L.C",
    logo: "logo-techniline.png",
    addressBar: "Unit #9, Al Shoala Building, Block E, Near DCC, Makani 31990 94438, PO Box 21566, Dubai, UAE  |  t +971 4 238 4000  |  f +971 4 236 9780  |  e sales@techniline.org  |  www.techniline.org",
    address: ["Post Box #21566", "Unit #9 - Ground Floor, Al Shoala Building, Block E, Street No.17", "Community No.129, Near Deira City Centre", "Deira, Dubai UAE"],
    tel: "+971 4 2384000",
    fax: "+971 4 2394799",
    email: "sales@techniline.org",
    web: "www.techniline.org",
  },
  soundline: {
    name: "Soundline Electronics LLC",
    logo: "logo-soundline.png",
    addressBar: "Shop No. 7-8, Al Musailla, Near Naif Park, P.O Box: 21566, Deira, Dubai, U.A.E  |  T: +971-4 223 1890/229 6659  |  F: +971 4 229 6643  |  E: slmain@techniline.org  |  www.techniline.org",
    address: ["P.O Box: 21566", "Shop No. 7-8, Al Musailla, Near Naif Park", "Deira, Dubai, U.A.E"],
    tel: "+971-4 223 1890 / 229 6659",
    fax: "+971 4 229 6643",
    email: "slmain@techniline.org",
    web: "www.techniline.org",
  },
};

function fmt2(n: number) {
  return Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt5(n: number | null | undefined) {
  if (n == null) return "";
  return Number(n).toFixed(5).replace(/\.?0+$/, "");
}

// Shared border style for table cells
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF94A3B8" } },
  bottom: { style: "thin", color: { argb: "FF94A3B8" } },
  left: { style: "thin", color: { argb: "FF94A3B8" } },
  right: { style: "thin", color: { argb: "FF94A3B8" } },
};

const BORDER_HEADER: Partial<ExcelJS.Borders> = {
  top: { style: "medium", color: { argb: "FF475569" } },
  bottom: { style: "medium", color: { argb: "FF475569" } },
  left: { style: "thin", color: { argb: "FF475569" } },
  right: { style: "thin", color: { argb: "FF475569" } },
};

type ItemRow = {
  sl_no: number;
  brand: string | null;
  model_no: string;
  description: string | null;
  country_of_origin: string | null;
  hs_code: string | null;
  qty: number;
  no_of_ctns: number | null;
  box_no: number | null;
  tot_cbm: number | null;
  total_weight_kg: number | null;
  unit_price: number | null;
  amount: number | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  const svc = svcClient();

  const [listRes, itemsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from("packing_lists" as any) as any).select("*").eq("id", id).single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from("packing_list_items" as any) as any)
      .select("*").eq("packing_list_id", id).order("sl_no", { ascending: true }),
  ]);

  if (listRes.error || !listRes.data) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  const list = listRes.data as {
    company: string;
    mode: string;
    invoice_no: string | null;
    list_date: string | null;
    consignee_name: string | null;
    consignee_address: string | null;
    shipping_label: string | null;
    notes: string | null;
  };
  const items: ItemRow[] = itemsRes.data ?? [];

  const company = COMPANY_INFO[list.company] ?? COMPANY_INFO["techniline"];
  const isInvoice = list.mode === "invoice";

  const totCBM = items.reduce((s, i) => s + (i.tot_cbm ?? 0), 0);
  const totWeight = items.reduce((s, i) => s + (i.total_weight_kg ?? 0), 0);
  const totCtns = items.reduce((s, i) => s + (i.no_of_ctns ?? 0), 0);
  const totQty = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const grandTotal = subtotal + vat;
  const countries = [...new Set(items.map(i => i.country_of_origin).filter(Boolean))].join(", ");
  const shippingLabel = (list as { shipping_label?: string | null }).shipping_label ?? null;
  const listDateFmt = list.list_date
    ? new Date(list.list_date).toLocaleDateString("en-AE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  function boxLabel(boxNo: number) {
    const lbl = shippingLabel?.trim().toUpperCase() ?? "";
    return lbl ? `${lbl}-${String(boxNo).padStart(2, "0")}` : `Box ${boxNo}`;
  }

  // ── Build workbook ──────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "Techniline Ops";
  const ws = wb.addWorksheet("Packing List", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 } });

  // 10 data columns + column A used for labels → define widths
  ws.columns = [
    { width: 5 },   // A: SL
    { width: 12 },  // B: Brand
    { width: 14 },  // C: Model No
    { width: 32 },  // D: Description
    { width: 12 },  // E: Country
    { width: 12 },  // F: HS Code
    { width: 7 },   // G: Qty
    { width: 12 },  // H: Ctns / Amount
    { width: 12 },  // I: Tot CBM
    { width: 14 },  // J: Total Weight
  ];

  const LAST_COL = "J";
  const NCOLS = 10;

  let rowIdx = 1;

  // ── Logo ────────────────────────────────────────────────────────────────
  const logoPath = path.join(process.cwd(), "public", company.logo);
  let logoImgId: number | null = null;
  if (fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logoImgId = wb.addImage({ buffer: logoBuffer as any, extension: "png" });
    ws.addImage(logoImgId, {
      tl: { col: 0, row: 0 },
      // span full width, fill the 93.75pt row (Excel EMUs: height in pixels ≈ pts * 96/72)
      ext: { width: 750, height: 125 },
      editAs: "oneCell",
    });
    ws.getRow(rowIdx).height = 93.75;
    ws.mergeCells(`A${rowIdx}:${LAST_COL}${rowIdx}`);
    rowIdx++;
  }

  // ── Address bar ─────────────────────────────────────────────────────────
  ws.mergeCells(`A${rowIdx}:${LAST_COL}${rowIdx}`);
  const addrCell = ws.getCell(`A${rowIdx}`);
  addrCell.value = company.addressBar;
  addrCell.font = { size: 7, color: { argb: "FF64748B" } };
  addrCell.alignment = { horizontal: "center", wrapText: true };
  ws.getRow(rowIdx).height = 22;
  rowIdx++;

  // ── Top border line ──────────────────────────────────────────────────────
  for (let c = 1; c <= NCOLS; c++) {
    ws.getCell(rowIdx, c).border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
  }
  ws.getRow(rowIdx).height = 4;
  rowIdx++;

  // ── Document title ───────────────────────────────────────────────────────
  ws.mergeCells(`A${rowIdx}:${LAST_COL}${rowIdx}`);
  const titleCell = ws.getCell(`A${rowIdx}`);
  titleCell.value = isInvoice ? "PACKING LIST / TAX INVOICE" : "PACKING LIST";
  titleCell.font = { bold: true, size: 11, underline: true };
  titleCell.alignment = { horizontal: "center" };
  ws.getRow(rowIdx).height = 18;
  rowIdx++;

  // Blank row
  ws.getRow(rowIdx).height = 4;
  rowIdx++;

  // ── Shipper / Consignee side by side ─────────────────────────────────────
  // Shipper in cols A-E (1-5), Consignee in cols F-J (6-10)
  const SPLIT = 5; // first half = cols 1..SPLIT, second = SPLIT+1..NCOLS

  function addHeaderPair(label1: string, val1: string, label2: string, val2: string) {
    const r = ws.getRow(rowIdx);
    r.height = 13;
    ws.mergeCells(rowIdx, 1, rowIdx, SPLIT);
    ws.mergeCells(rowIdx, SPLIT + 1, rowIdx, NCOLS);
    ws.getCell(rowIdx, 1).value = `${label1}  ${val1}`;
    ws.getCell(rowIdx, 1).font = label1 === "Shipper:" ? { bold: true, size: 8 } : { size: 8 };
    ws.getCell(rowIdx, SPLIT + 1).value = `${label2}  ${val2}`;
    ws.getCell(rowIdx, SPLIT + 1).font = label2 === "Consignee:" ? { bold: true, size: 8 } : { size: 8 };
    ws.getCell(rowIdx, SPLIT + 1).alignment = { horizontal: "right" };
    rowIdx++;
  }

  addHeaderPair("Shipper:", company.name, "Consignee:", list.consignee_name ?? "");
  company.address.forEach((line, i) => {
    const consigneeLine = (list.consignee_address ?? "").split("\n")[i] ?? "";
    addHeaderPair("", line, "", consigneeLine);
  });
  addHeaderPair("Tel:", company.tel, "Date:", listDateFmt);
  addHeaderPair("Fax:", company.fax, "Invoice No:", list.invoice_no ?? "");
  if (shippingLabel) addHeaderPair("", "", "Shipping Label:", shippingLabel.toUpperCase());

  // Blank
  ws.getRow(rowIdx).height = 4;
  rowIdx++;

  // ── Table header ─────────────────────────────────────────────────────────
  const headerValues = ["SL", "Brand", "Model No", "Description", "Country", "HS Code", "Qty",
    isInvoice ? "Amount (AED)" : "No. of Ctns", "Tot. CBM", "Total Wt (kg)"];

  const headerRow = ws.getRow(rowIdx);
  headerRow.height = 16;
  headerValues.forEach((v, ci) => {
    const cell = ws.getCell(rowIdx, ci + 1);
    cell.value = v;
    cell.font = { bold: true, size: 8.5, color: { argb: "FF1E293B" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    cell.alignment = { horizontal: ci < 4 ? "left" : "center", vertical: "middle" };
    cell.border = BORDER_HEADER;
  });
  rowIdx++;

  // ── Data rows ────────────────────────────────────────────────────────────
  // Group by box_no for rowspan-like display (show box label only on first item in group)
  const groups: { item: ItemRow; firstInGroup: boolean; groupCtns: number | null; groupLabel: string | null }[] = [];
  let gi = 0;
  while (gi < items.length) {
    const item = items[gi];
    const boxNo = item.box_no ?? 0;
    if (boxNo > 0) {
      let j = gi;
      while (j < items.length && (items[j].box_no ?? 0) === boxNo) j++;
      const groupCtns = items[gi].no_of_ctns;
      const groupLbl = boxLabel(boxNo);
      for (let k = gi; k < j; k++) {
        groups.push({ item: items[k], firstInGroup: k === gi, groupCtns: groupCtns ?? null, groupLabel: groupLbl });
      }
      gi = j;
    } else {
      groups.push({ item, firstInGroup: true, groupCtns: item.no_of_ctns ?? null, groupLabel: null });
      gi++;
    }
  }

  for (const { item, firstInGroup, groupCtns, groupLabel } of groups) {
    const dr = ws.getRow(rowIdx);
    dr.height = 14;

    const cells: { col: number; value: ExcelJS.CellValue; align: ExcelJS.Alignment["horizontal"]; mono?: boolean }[] = [
      { col: 1, value: item.sl_no, align: "center" },
      { col: 2, value: item.brand ?? "", align: "left" },
      { col: 3, value: item.model_no, align: "left", mono: true },
      { col: 4, value: item.description ?? "", align: "left" },
      { col: 5, value: item.country_of_origin ?? "", align: "center" },
      { col: 6, value: item.hs_code ?? "", align: "center" },
      { col: 7, value: item.qty, align: "center" },
    ];

    if (isInvoice) {
      cells.push({ col: 8, value: item.amount != null ? Number(item.amount) : "", align: "right" });
    } else {
      cells.push({
        col: 8,
        value: firstInGroup
          ? (groupLabel ? `${groupLabel}\n${groupCtns ?? ""}` : (item.no_of_ctns ?? ""))
          : "",
        align: "center",
      });
    }

    cells.push({ col: 9, value: fmt5(item.tot_cbm), align: "center" });
    cells.push({ col: 10, value: item.total_weight_kg != null ? Number(item.total_weight_kg).toFixed(2) : "", align: "center" });

    cells.forEach(({ col, value, align, mono }) => {
      const cell = ws.getCell(rowIdx, col);
      cell.value = value;
      cell.font = { size: 8, name: mono ? "Courier New" : undefined };
      cell.alignment = { horizontal: align, vertical: "middle", wrapText: col === 4 || col === 8 };
      cell.border = BORDER;
    });
    rowIdx++;
  }

  // ── Totals row ────────────────────────────────────────────────────────────
  const totRow = ws.getRow(rowIdx);
  totRow.height = 14;
  const totValues: { col: number; value: ExcelJS.CellValue; align: ExcelJS.Alignment["horizontal"] }[] = [
    { col: 6, value: "Total:-", align: "right" },
    { col: 7, value: totQty, align: "center" },
    { col: 8, value: isInvoice ? fmt2(subtotal) : totCtns, align: isInvoice ? "right" : "center" },
    { col: 9, value: fmt5(totCBM), align: "center" },
    { col: 10, value: totWeight.toFixed(2), align: "center" },
  ];
  // Merge cols 1-5 for the empty label area
  ws.mergeCells(rowIdx, 1, rowIdx, 5);
  for (let c = 1; c <= NCOLS; c++) {
    const cell = ws.getCell(rowIdx, c);
    cell.font = { bold: true, size: 8.5 };
    cell.border = { ...BORDER_HEADER };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  }
  totValues.forEach(({ col, value, align }) => {
    const cell = ws.getCell(rowIdx, col);
    cell.value = value;
    cell.alignment = { horizontal: align, vertical: "middle" };
  });
  rowIdx++;

  // ── VAT block (invoice only) ──────────────────────────────────────────────
  if (isInvoice) {
    ws.getRow(rowIdx).height = 6;
    rowIdx++;

    const vatRows = [
      ["Subtotal", fmt2(subtotal)],
      ["VAT 5%", fmt2(vat)],
      ["Grand Total", fmt2(grandTotal)],
    ];
    for (const [label, val] of vatRows) {
      ws.mergeCells(rowIdx, 1, rowIdx, 8);
      ws.mergeCells(rowIdx, 9, rowIdx, 10);
      const lCell = ws.getCell(rowIdx, 1);
      lCell.value = label;
      lCell.alignment = { horizontal: "right" };
      lCell.font = { bold: label === "Grand Total", size: 9 };
      const vCell = ws.getCell(rowIdx, 9);
      vCell.value = `AED  ${val}`;
      vCell.alignment = { horizontal: "right" };
      vCell.font = { bold: label === "Grand Total", size: 9 };
      if (label === "Grand Total") {
        for (let c = 1; c <= NCOLS; c++) {
          ws.getCell(rowIdx, c).border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
        }
      }
      ws.getRow(rowIdx).height = 14;
      rowIdx++;
    }
  }

  // ── Summary footer ────────────────────────────────────────────────────────
  ws.getRow(rowIdx).height = 8;
  rowIdx++;

  const summaryLines = [
    `Weight (KG): ${totWeight.toFixed(2)}`,
    `Total Cartons: ${totCtns}`,
    ...(countries ? [`Country of Origin: ${countries}`] : []),
    ...(list.notes ? [`Notes: ${list.notes}`] : []),
  ];
  for (const line of summaryLines) {
    ws.mergeCells(`A${rowIdx}:${LAST_COL}${rowIdx}`);
    const cell = ws.getCell(`A${rowIdx}`);
    cell.value = line;
    cell.font = { size: 8, bold: true };
    ws.getRow(rowIdx).height = 13;
    rowIdx++;
  }

  // ── Signature row ─────────────────────────────────────────────────────────
  ws.getRow(rowIdx).height = 40;
  rowIdx++;
  ws.mergeCells(rowIdx, 1, rowIdx, 5);
  ws.mergeCells(rowIdx, 6, rowIdx, NCOLS);
  const sig1 = ws.getCell(rowIdx, 1);
  sig1.value = "Stamp & Signature\nAuthorised Signatory (Customer)";
  sig1.font = { size: 8 };
  sig1.alignment = { vertical: "bottom", wrapText: true };
  const sig2 = ws.getCell(rowIdx, 6);
  sig2.value = `${company.name.toUpperCase()}\nAuthorised Signatory`;
  sig2.font = { size: 8, bold: true };
  sig2.alignment = { horizontal: "right", vertical: "bottom", wrapText: true };
  ws.getRow(rowIdx).height = 28;

  // ── Box Breakdown sheet (only when boxes are assigned) ───────────────────
  const assignedBoxNos = [...new Set(items.map(i => i.box_no).filter((b): b is number => (b ?? 0) > 0))].sort((a, b) => a - b);

  if (assignedBoxNos.length > 0) {
    const ws2 = wb.addWorksheet("Box Breakdown", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 } });
    const BB_COLS = 7;
    ws2.columns = [
      { width: 5 },   // A: #
      { width: 12 },  // B: Brand
      { width: 14 },  // C: Model No
      { width: 40 },  // D: Description
      { width: 7 },   // E: Qty
      { width: 12 },  // F: Tot CBM
      { width: 14 },  // G: Weight Kgs
    ];

    let r2 = 1;

    // Logo (reuse same image id)
    if (logoImgId !== null) {
      ws2.addImage(logoImgId, {
        tl: { col: 0, row: 0 },
        ext: { width: 750, height: 125 },
        editAs: "oneCell",
      });
      ws2.getRow(r2).height = 93.75;
      ws2.mergeCells(r2, 1, r2, BB_COLS);
      r2++;
    }

    // Address bar
    ws2.mergeCells(r2, 1, r2, BB_COLS);
    const a2 = ws2.getCell(r2, 1);
    a2.value = company.addressBar;
    a2.font = { size: 7, color: { argb: "FF64748B" } };
    a2.alignment = { horizontal: "center", wrapText: true };
    ws2.getRow(r2).height = 22;
    r2++;

    // Border line
    for (let c = 1; c <= BB_COLS; c++) ws2.getCell(r2, c).border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
    ws2.getRow(r2).height = 4;
    r2++;

    // Title
    ws2.mergeCells(r2, 1, r2, BB_COLS);
    const t2 = ws2.getCell(r2, 1);
    t2.value = "BOX BREAKDOWN";
    t2.font = { bold: true, size: 11, underline: true };
    t2.alignment = { horizontal: "center" };
    ws2.getRow(r2).height = 18;
    r2++;

    if (shippingLabel) {
      ws2.mergeCells(r2, 1, r2, BB_COLS);
      const sl2 = ws2.getCell(r2, 1);
      sl2.value = `Shipping Label: ${shippingLabel.toUpperCase()}`;
      sl2.font = { bold: true, size: 9 };
      sl2.alignment = { horizontal: "center" };
      ws2.getRow(r2).height = 14;
      r2++;
    }

    ws2.getRow(r2).height = 6;
    r2++;

    // Per-box sections
    for (const boxNo of assignedBoxNos) {
      const boxItems = items.filter(i => (i.box_no ?? 0) === boxNo);
      const boxCtns = boxItems.reduce((s, i) => s + (i.no_of_ctns ?? 0), 0);
      const boxCBM  = boxItems.reduce((s, i) => s + (i.tot_cbm ?? 0), 0);
      const boxWeight = boxItems.reduce((s, i) => s + (i.total_weight_kg ?? 0), 0);
      const lbl = boxLabel(boxNo);

      // Box header
      ws2.mergeCells(r2, 1, r2, BB_COLS);
      const bh = ws2.getCell(r2, 1);
      bh.value = `${lbl}   ${boxCtns} carton${boxCtns !== 1 ? "s" : ""}   CBM: ${fmt5(boxCBM)}   Weight: ${boxWeight.toFixed(2)} kg`;
      bh.font = { bold: true, size: 9 };
      bh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      bh.border = BORDER_HEADER;
      ws2.getRow(r2).height = 15;
      r2++;

      // Column headers for this box's table
      const bbHeaders = ["#", "Brand", "Model No", "Description", "Qty", "Tot. CBM", "Weight Kgs"];
      bbHeaders.forEach((v, ci) => {
        const cell = ws2.getCell(r2, ci + 1);
        cell.value = v;
        cell.font = { bold: true, size: 8, color: { argb: "FF1E293B" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        cell.alignment = { horizontal: ci < 4 ? "left" : "center", vertical: "middle" };
        cell.border = BORDER_HEADER;
      });
      ws2.getRow(r2).height = 14;
      r2++;

      // Items
      boxItems.forEach((item, i) => {
        const rowData: { col: number; value: ExcelJS.CellValue; align: ExcelJS.Alignment["horizontal"]; mono?: boolean }[] = [
          { col: 1, value: i + 1, align: "center" },
          { col: 2, value: item.brand ?? "", align: "left" },
          { col: 3, value: item.model_no, align: "left", mono: true },
          { col: 4, value: item.description ?? "", align: "left" },
          { col: 5, value: item.qty, align: "center" },
          { col: 6, value: fmt5(item.tot_cbm), align: "center" },
          { col: 7, value: item.total_weight_kg != null ? Number(item.total_weight_kg).toFixed(2) : "", align: "center" },
        ];
        rowData.forEach(({ col, value, align, mono }) => {
          const cell = ws2.getCell(r2, col);
          cell.value = value;
          cell.font = { size: 8, name: mono ? "Courier New" : undefined };
          cell.alignment = { horizontal: align, vertical: "middle", wrapText: col === 4 };
          cell.border = BORDER;
        });
        ws2.getRow(r2).height = 13;
        r2++;
      });

      ws2.getRow(r2).height = 5;
      r2++;
    }

    // Summary footer
    ws2.getRow(r2).height = 4;
    r2++;
    const bbSummary = `Total Boxes: ${assignedBoxNos.length}   Total Cartons: ${totCtns}   Total CBM: ${fmt5(totCBM)}   Total Weight: ${totWeight.toFixed(2)} kg`;
    ws2.mergeCells(r2, 1, r2, BB_COLS);
    const bsFoot = ws2.getCell(r2, 1);
    bsFoot.value = bbSummary;
    bsFoot.font = { bold: true, size: 8.5 };
    for (let c = 1; c <= BB_COLS; c++) ws2.getCell(r2, c).border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
    ws2.getRow(r2).height = 14;
  }

  // ── Serialize and return ──────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();

  const safeInvNo = (list.invoice_no ?? id).replace(/[^A-Za-z0-9_-]/g, "_");
  const filename = `PackingList_${safeInvNo}_${list.list_date ?? "draft"}.xlsx`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Response(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
