import { supabase } from "@/lib/supabaseClient";
import { chargeTypeLabel } from "@/lib/remittanceDeductions";

import type { ReturnRow } from "./types";

/**
 * Fetch all returns, most recently received first. Read-only.
 */
export async function fetchReturns(): Promise<ReturnRow[]> {
  const { data, error } = await supabase
    .from("returns")
    .select("*")
    .order("date_received", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ── Manual return logging ────────────────────────────────────────────────

export type ReturnType = "vendor_return" | "return_dispute" | "shortage_claim" | "price_claim";

export const RETURN_TYPES: { value: ReturnType; label: string }[] = [
  { value: "vendor_return", label: "Vendor Return" },
  { value: "return_dispute", label: "Return Dispute" },
  { value: "shortage_claim", label: "Shortage Claim" },
  { value: "price_claim", label: "Price Claim (PRT)" },
];

export interface ReturnDraft {
  return_type: ReturnType | null;
  return_date: string;          // date picker — maps to date_received
  return_id: string;            // Shipment Request ID (VRET...)
  vret_number: string;          // numeric Return ID (second column)
  authorization_id: string;     // AMZN auth ID
  warehouse: string;            // XAEE / XAEC / DXB3 etc.
  amazon_invoice: string;       // Amazon invoice number (7500...)
  po_number: string;
  tle_invoice_number: string;   // ERP-Invoice (WS...)
  model_sku: string;
  qty: string;
  amount: string;               // Total cost AED
  srt_number: string;
  prt_number: string;
  dispute_id: string;
  amazon_case_id: string;
  tracking_number: string;
  comments: string;
}

const has = (s: string) => Boolean(s && s.trim());

/** Which fields are relevant for a given return type (drives visibility). */
export function returnFieldsFor(t: ReturnType | null): {
  po: boolean; tle: boolean; srt: boolean; prt: boolean; dispute: boolean; caseId: boolean;
} {
  switch (t) {
    case "vendor_return": return { po: true, tle: true, srt: true, prt: true, dispute: false, caseId: true };
    case "return_dispute": return { po: true, tle: true, srt: false, prt: false, dispute: true, caseId: true };
    case "shortage_claim": return { po: false, tle: false, srt: true, prt: false, dispute: true, caseId: true };
    case "price_claim": return { po: false, tle: false, srt: false, prt: true, dispute: false, caseId: false };
    default: return { po: false, tle: false, srt: false, prt: false, dispute: false, caseId: false };
  }
}

/** Missing mandatory fields for a return (empty list = ready to save). */
export function validateReturn(d: ReturnDraft): string[] {
  const miss: string[] = [];
  if (!d.return_type) return ["Return type"];
  if (!has(d.comments)) miss.push("Remarks");

  if (d.return_type === "vendor_return") {
    if (!has(d.return_id)) miss.push("Return ID");
    if (!has(d.po_number)) miss.push("PO Number");
    if (!has(d.tle_invoice_number)) miss.push("TLE Invoice Number");
  }
  if (d.return_type === "return_dispute") {
    if (!has(d.return_id)) miss.push("Return ID");
    if (!has(d.dispute_id)) miss.push("Dispute ID");
    if (!has(d.po_number)) miss.push("PO Number");
    if (!has(d.tle_invoice_number)) miss.push("TLE Invoice Number");
    if (!has(d.amount)) miss.push("Amount");
  }
  if (d.return_type === "shortage_claim") {
    if (!has(d.srt_number) && !has(d.dispute_id) && !has(d.amazon_case_id)) {
      miss.push("SRT # or Dispute ID or Case ID");
    }
  }
  if (d.return_type === "price_claim") {
    if (!has(d.prt_number)) miss.push("PRT Number");
  }
  return miss;
}

/** Save a manually-logged return into the returns table. */
export async function logReturn(d: ReturnDraft, loggedBy: string): Promise<void> {
  const missing = validateReturn(d);
  if (missing.length > 0) throw new Error(`Fill required: ${missing.join(", ")}`);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const str = (s: string) => s.trim() || null;
  // returns.return_id is NOT NULL — fall back to the strongest available ref.
  const returnId =
    d.return_id.trim() ||
    d.srt_number.trim() ||
    d.prt_number.trim() ||
    d.dispute_id.trim() ||
    d.amazon_case_id.trim() ||
    `RET-${new Date().toISOString().slice(0, 19).replace(/[:T-]/g, "")}`;

  const { error } = await supabase.from("returns").insert({
    return_id: returnId,
    vret_number: str(d.vret_number),
    authorization_id: str(d.authorization_id),
    return_type: d.return_type,
    date_received: d.return_date.trim() || new Date().toISOString().slice(0, 10),
    warehouse: str(d.warehouse),
    amazon_invoice: str(d.amazon_invoice),
    po_number: str(d.po_number),
    tle_invoice_number: str(d.tle_invoice_number),
    model_sku: str(d.model_sku),
    qty: num(d.qty),
    total_cost_aed: num(d.amount),
    srt_number: str(d.srt_number),
    prt_number: str(d.prt_number),
    dispute_id_ref: str(d.dispute_id),
    amazon_case_id: str(d.amazon_case_id),
    tracking_number: str(d.tracking_number),
    comments: str(d.comments),
    source: "manual",
    status: "open",
    logged_by: loggedBy,
  });
  if (error) throw new Error(error.message);
}

/** A return from either source, normalised for the monthly Returns view. */
export interface UnifiedReturn {
  id: string;
  source: "email" | "remittance" | "manual";
  date: string | null;
  returnId: string | null;      // Shipment Request ID
  vretNumber: string | null;    // numeric Return ID
  authorizationId: string | null;
  reference: string | null;     // Amazon invoice / PO
  warehouse: string | null;
  sku: string | null;
  qty: number | null;
  poNumber: string | null;
  erpInvoice: string | null;    // tle_invoice_number (WS...)
  type: string | null;
  amount: number | null;        // total cost AED
  recovery: number | null;      // approved / recovered
  status: string | null;
  srtNumber: string | null;
  prtNumber: string | null;
  disputeId: string | null;
  caseId: string | null;
  trackingNumber: string | null;
  comments: string | null;
}

/**
 * Combined returns from BOTH sources, newest first:
 *  - the `returns` table (Amazon return-notification emails), and
 *  - remittance deductions categorised as Vendor Return / Return Dispute.
 * The page filters these by month. Fail-soft: skips a source that errors.
 */
export async function fetchCombinedReturns(): Promise<UnifiedReturn[]> {
  const [emailRes, dedRes] = await Promise.all([
    // Only manually-logged returns — the legacy v1 email-imported rows (junk like
    // "is"/"for"/"type_a") are excluded so the list is clean and actionable.
    supabase.from("returns").select("*").eq("source", "manual").order("date_received", { ascending: false }).limit(500),
    supabase
      .from("remittance_deductions")
      .select("*")
      .in("charge_type", ["vendor_return", "return_dispute", "shortage_claim"])
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const out: UnifiedReturn[] = [];

  for (const r of (emailRes.data ?? []) as ReturnRow[]) {
    out.push({
      id: `e_${r.id}`,
      source: r.source === "manual" ? "manual" : "email",
      date: r.date_received ?? r.created_at ?? null,
      returnId: r.return_id ?? null,
      vretNumber: r.vret_number ?? null,
      authorizationId: (r as unknown as Record<string, string | null>)["authorization_id"] ?? null,
      reference: r.amazon_invoice ?? null,
      warehouse: r.warehouse ?? null,
      sku: r.model_sku ?? null,
      qty: r.qty ?? null,
      poNumber: r.po_number ?? null,
      erpInvoice: r.tle_invoice_number ?? null,
      type: r.return_type ?? "Return",
      amount: r.total_cost_aed ?? r.refund_aed ?? r.recovery_amt_aed ?? null,
      recovery: r.recovery_amt_aed ?? null,
      status: r.dispute_status_text ?? r.status ?? null,
      srtNumber: r.srt_number ?? null,
      prtNumber: r.prt_number ?? null,
      disputeId: r.dispute_id_ref ?? null,
      caseId: r.amazon_case_id ?? null,
      trackingNumber: (r as unknown as Record<string, string | null>)["tracking_number"] ?? null,
      comments: r.comments ?? null,
    });
  }

  for (const d of dedRes.data ?? []) {
    out.push({
      id: `r_${d.id}`,
      source: "remittance",
      date: d.recovery_date ?? d.created_at ?? null,
      returnId: d.return_id ?? null,
      vretNumber: null,
      authorizationId: null,
      reference: d.po_number ?? d.tle_invoice_number ?? d.remittance_ref ?? null,
      warehouse: null,
      sku: null,
      qty: null,
      poNumber: d.po_number ?? null,
      erpInvoice: d.tle_invoice_number ?? null,
      type: chargeTypeLabel(d.charge_type),
      amount: d.amount_aed != null ? Math.abs(d.amount_aed) : d.claim_amount_aed ?? null,
      recovery: d.approved_amount_aed ?? null,
      status: d.dispute_status ?? (d.status === "closed" ? "Closed" : "Open"),
      srtNumber: null,
      prtNumber: null,
      disputeId: null,
      caseId: null,
      trackingNumber: null,
      comments: null,
    });
  }

  out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return out;
}
