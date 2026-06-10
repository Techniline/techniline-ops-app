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
  return_id: string;
  po_number: string;
  tle_invoice_number: string;
  model_sku: string;
  qty: string;
  amount: string;
  srt_number: string;
  prt_number: string;
  dispute_id: string;
  amazon_case_id: string;
  payment_number: string;
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
    return_type: d.return_type,
    po_number: d.po_number.trim() || null,
    tle_invoice_number: d.tle_invoice_number.trim() || null,
    model_sku: d.model_sku.trim() || null,
    qty: num(d.qty),
    total_cost_aed: num(d.amount),
    srt_number: d.srt_number.trim() || null,
    prt_number: d.prt_number.trim() || null,
    dispute_id: d.dispute_id.trim() || null,
    amazon_case_id: d.amazon_case_id.trim() || null,
    payment_number: d.payment_number.trim() || null,
    comments: d.comments.trim() || null,
    source: "manual",
    status: "open",
    date_received: new Date().toISOString().slice(0, 10),
    logged_by: loggedBy,
  });
  if (error) throw new Error(error.message);
}

/** A return from either source, normalised for the monthly Returns view. */
export interface UnifiedReturn {
  id: string;
  source: "email" | "remittance" | "manual";
  date: string | null;
  returnId: string | null;
  reference: string | null; // invoice / PO
  sku: string | null;
  type: string | null;
  amount: number | null; // value of the return / deduction
  recovery: number | null; // approved / recovered
  status: string | null;
}

/**
 * Combined returns from BOTH sources, newest first:
 *  - the `returns` table (Amazon return-notification emails), and
 *  - remittance deductions categorised as Vendor Return / Return Dispute.
 * The page filters these by month. Fail-soft: skips a source that errors.
 */
export async function fetchCombinedReturns(): Promise<UnifiedReturn[]> {
  const [emailRes, dedRes] = await Promise.all([
    supabase.from("returns").select("*").order("date_received", { ascending: false }).limit(500),
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
      reference: r.amazon_invoice ?? r.po_number ?? null,
      sku: r.model_sku ?? null,
      type: r.return_type ?? "Return",
      amount: r.refund_aed ?? r.recovery_amt_aed ?? null,
      recovery: r.recovery_amt_aed ?? null,
      status: r.dispute_status_text ?? null,
    });
  }

  for (const d of dedRes.data ?? []) {
    out.push({
      id: `r_${d.id}`,
      source: "remittance",
      date: d.recovery_date ?? d.created_at ?? null,
      returnId: d.return_id ?? null,
      reference: d.po_number ?? d.tle_invoice_number ?? d.remittance_ref ?? null,
      sku: null,
      type: chargeTypeLabel(d.charge_type),
      amount: d.amount_aed != null ? Math.abs(d.amount_aed) : d.claim_amount_aed ?? null,
      recovery: d.approved_amount_aed ?? null,
      status: d.dispute_status ?? (d.status === "closed" ? "Closed" : "Open"),
    });
  }

  out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return out;
}
