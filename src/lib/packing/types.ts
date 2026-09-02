export type PackingCompany = "techniline" | "soundline";
export type PackingMode = "physical" | "invoice";
export type PackingStatus = "draft" | "final";

export interface SkuCatalogRow {
  id: string;
  model_no: string;
  brand: string | null;
  description: string | null;
  hs_code: string | null;
  country_of_origin: string;
  unit_weight_kg: number | null;
  unit_cbm: number | null;
  carton_qty: number | null;
  carton_weight_kg: number | null;
  carton_cbm: number | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface PackingListRow {
  id: string;
  company: PackingCompany;
  mode: PackingMode;
  invoice_no: string | null;
  list_date: string;
  consignee_name: string | null;
  consignee_address: string | null;
  notes: string | null;
  status: PackingStatus;
  shipping_label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackingListItemRow {
  id: string;
  packing_list_id: string;
  sl_no: number;
  model_no: string;
  brand: string | null;
  description: string | null;
  hs_code: string | null;
  country_of_origin: string | null;
  qty: number;
  no_of_ctns: number | null;
  tot_cbm: number | null;
  total_weight_kg: number | null;
  unit_price: number | null;
  amount: number | null;
  box_no: number | null;
}

/** Editable line during builder session (before save). */
export interface PackingLine {
  key: string; // local uuid for React key
  model_no: string;
  brand: string;
  description: string;
  hs_code: string;
  country_of_origin: string;
  qty: number;
  no_of_ctns: number;
  tot_cbm: number;
  total_weight_kg: number;
  unit_price: number; // invoice mode only
  amount: number; // qty × unit_price
  box_no: number; // physical carton assignment; shared box_no = merged into one carton
  // source catalog data (for recalc)
  _sku_id: string | null;
  _unit_weight_kg: number | null;
  _unit_cbm: number | null;
  _carton_qty: number | null;
  _carton_weight_kg: number | null;
  _carton_cbm: number | null;
  // split tracking (UI-only, not persisted)
  _parent_key?: string;
  _split_from_qty?: number;
}

export const COMPANY_INFO: Record<PackingCompany, {
  name: string;
  logo: string;
  addressBar: string;
  address: string[];
  tel: string;
  fax: string;
  email: string;
  web: string;
}> = {
  techniline: {
    name: "Techniline Electronic L.L.C",
    logo: "/logo-techniline.png",
    addressBar: "Unit #9, Al Shoala Building, Block E, Near DCC, Makani 31990 94438, PO Box 21566, Dubai, UAE  |  t +971 4 238 4000  |  f +971 4 236 9780  |  e sales@techniline.org  |  www.techniline.org",
    address: [
      "Post Box #21566",
      "Unit #9 - Ground Floor, Al Shoala Building, Block E, Street No.17",
      "Community No.129, Near Deira City Centre",
      "Deira, Dubai UAE",
    ],
    tel: "+971 4 2384000",
    fax: "+971 4 2394799",
    email: "sales@techniline.org",
    web: "www.techniline.org",
  },
  soundline: {
    name: "Soundline Electronics LLC",
    logo: "/logo-soundline.png",
    addressBar: "Shop No. 7-8, Al Musailla, Near Naif Park, P.O Box: 21566, Deira, Dubai, U.A.E  |  T: +971-4 223 1890/229 6659  |  F: +971 4 229 6643  |  E: slmain@techniline.org  |  www.techniline.org",
    address: [
      "P.O Box: 21566",
      "Shop No. 7-8, Al Musailla, Near Naif Park",
      "Deira, Dubai, U.A.E",
    ],
    tel: "+971-4 223 1890 / 229 6659",
    fax: "+971 4 229 6643",
    email: "slmain@techniline.org",
    web: "www.techniline.org",
  },
};

/** Compute physical fields from qty + catalog data. */
export function computePhysical(
  qty: number,
  sku: Pick<SkuCatalogRow, "unit_weight_kg" | "unit_cbm" | "carton_qty" | "carton_weight_kg" | "carton_cbm">
): { no_of_ctns: number; tot_cbm: number; total_weight_kg: number } {
  const cq = sku.carton_qty && sku.carton_qty > 0 ? sku.carton_qty : 1;
  const no_of_ctns = Math.ceil(qty / cq);

  let tot_cbm = 0;
  if (sku.carton_cbm && sku.carton_cbm > 0) {
    tot_cbm = no_of_ctns * sku.carton_cbm;
  } else if (sku.unit_cbm && sku.unit_cbm > 0) {
    tot_cbm = qty * sku.unit_cbm;
  }

  let total_weight_kg = 0;
  if (sku.unit_weight_kg && sku.unit_weight_kg > 0) {
    total_weight_kg = qty * sku.unit_weight_kg;
  } else if (sku.carton_weight_kg && sku.carton_weight_kg > 0 && cq > 0) {
    // Derive per-unit weight from carton data — always proportional, never a full carton for partial qty
    total_weight_kg = qty * (sku.carton_weight_kg / cq);
  }

  return {
    no_of_ctns,
    tot_cbm: Math.round(tot_cbm * 100000) / 100000,
    total_weight_kg: Math.round(total_weight_kg * 100) / 100,
  };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function chunk(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + chunk(n % 100) : "");
}

/** Convert an AED amount to English words (e.g. 1234.56 → "One Thousand Two Hundred Thirty Four and Fils Fifty Six Only"). */
export function aedToWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  const rounded = Math.round(amount * 100);
  const dirhams = Math.floor(rounded / 100);
  const fils = rounded % 100;

  const dirhamWords = dirhams === 0 ? "Zero" : (
    dirhams >= 1_000_000
      ? chunk(Math.floor(dirhams / 1_000_000)) + " Million " + (dirhams % 1_000_000 ? chunk(Math.floor((dirhams % 1_000_000) / 1000)) + " Thousand " + chunk(dirhams % 1000) : "")
      : dirhams >= 1_000
      ? chunk(Math.floor(dirhams / 1_000)) + " Thousand " + (dirhams % 1_000 ? chunk(dirhams % 1_000) : "")
      : chunk(dirhams)
  ).replace(/\s+/g, " ").trim();

  return `AED: ${dirhamWords}${fils > 0 ? ` and Fils ${chunk(fils)}` : ""} Only`;
}
