import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type RemittanceDeduction = Tables<"remittance_deductions">;

export type ChargeType =
  | "vendor_return"
  | "return_dispute"
  | "shortage_claim"
  | "price_claim"
  | "coop_mdf"
  | "chargeback_compliance"
  | "damage_defective"
  | "other";

export const CHARGE_TYPES: { value: ChargeType; label: string }[] = [
  { value: "vendor_return", label: "Vendor Return" },
  { value: "return_dispute", label: "Return Dispute" },
  { value: "shortage_claim", label: "Shortage Claim" },
  { value: "price_claim", label: "Price Claim (PRT)" },
  { value: "coop_mdf", label: "Co-op / MDF" },
  { value: "chargeback_compliance", label: "Chargeback / Compliance" },
  { value: "damage_defective", label: "Damage / Defective" },
  { value: "other", label: "Other Amazon Charges" },
];

export function chargeTypeLabel(v: string | null): string {
  return CHARGE_TYPES.find((c) => c.value === v)?.label ?? "—";
}

export const DISPUTE_STATUSES = [
  "Open",
  "Pending Amazon",
  "Approved",
  "Partially Approved",
  "Rejected",
  "Closed",
] as const;

/** The editable fields a deduction form collects. */
export interface DeductionDraft {
  charge_type: ChargeType | null;
  return_id: string;
  po_number: string;
  tle_invoice_number: string;
  srt_number: string;
  prt_number: string;
  dispute_id: string;
  amazon_case_id: string;
  return_missing: boolean;
  claim_amount_aed: string;
  approved_amount_aed: string;
  recovery_date: string;
  dispute_status: string;
  remark: string;
}

const has = (s: string | null | undefined) => Boolean(s && s.trim());

/**
 * Validate whether a deduction can be closed. Returns the list of missing
 * mandatory fields (empty list = ready to close). Mirrors the agreed model.
 */
export function validateClosure(d: DeductionDraft): string[] {
  const miss: string[] = [];
  if (!d.charge_type) return ["Charge type"];
  if (!has(d.remark)) miss.push("Remark");

  // For return-based types, return id (or Amazon case if the return is missing).
  const needsReturnEvidence = d.charge_type === "vendor_return" || d.charge_type === "return_dispute";
  if (needsReturnEvidence) {
    if (d.return_missing) {
      if (!has(d.amazon_case_id)) miss.push("Amazon Case ID (return not found)");
    } else if (!has(d.return_id)) {
      miss.push("Return ID");
    }
  }

  if (d.charge_type === "vendor_return") {
    if (!has(d.po_number)) miss.push("PO Number");
    if (!has(d.tle_invoice_number)) miss.push("TLE Invoice Number");
  }

  if (d.charge_type === "return_dispute") {
    if (!has(d.dispute_id)) miss.push("Dispute ID");
    if (!has(d.po_number)) miss.push("PO Number");
    if (!has(d.tle_invoice_number)) miss.push("TLE Invoice Number");
    if (!has(d.claim_amount_aed)) miss.push("Claim Amount AED");
  }

  if (d.charge_type === "shortage_claim") {
    if (!has(d.srt_number) && !has(d.dispute_id) && !has(d.amazon_case_id)) {
      miss.push("SRT # or Dispute ID or Amazon Case ID");
    }
  }

  if (d.charge_type === "price_claim") {
    if (!has(d.prt_number)) miss.push("PRT Number");
  }

  return miss;
}

/** Recovery % = approved ÷ claim (0 when claim is 0/blank). */
export function recoveryPct(claim: number | null, approved: number | null): number | null {
  if (!claim || claim <= 0) return null;
  return Math.round(((approved ?? 0) / claim) * 100);
}

export async function fetchDeductions(opts: { includeClosed: boolean }): Promise<RemittanceDeduction[]> {
  let q = supabase.from("remittance_deductions").select("*");
  if (!opts.includeClosed) q = q.eq("status", "open");
  q = q.order("created_at", { ascending: true });
  const { data, error } = await q;
  if (error) return [];
  return data ?? [];
}

export interface RemittancePayment {
  id: string; // expected_actions.id
  ref: string;
  amount: number | null; // net paid captured from the email
  receivedAt: string | null;
  subject: string | null;
}

// Start tracking remittances from this date forward (no historical backlog).
const REMITTANCE_START = "2026-06-10";

/** Ingested remittance payments still needing review (from the Amazon-actions feed). */
export async function fetchOpenRemittancePayments(): Promise<RemittancePayment[]> {
  const { data, error } = await supabase
    .from("expected_actions")
    .select("id, ref_number, aed_amount, email_received_at, email_subject, status, type")
    .eq("type", "remittance")
    .gte("email_received_at", REMITTANCE_START)
    .order("email_received_at", { ascending: false });
  if (error || !data) return [];
  return data
    .filter(
      (r) =>
        r.status !== "resolved" &&
        r.ref_number &&
        /^\d{6,}$/.test(r.ref_number) // real Amazon payment numbers only (drops "Payment Advice")
    )
    .map((r) => ({
      id: r.id as string,
      ref: r.ref_number as string,
      amount: r.aed_amount as number | null,
      receivedAt: r.email_received_at as string | null,
      subject: r.email_subject as string | null,
    }));
}

/** Mark a remittance payment reviewed — resolves the Amazon-actions item too. */
export async function markRemittanceReviewed(expectedActionId: string): Promise<void> {
  const { error } = await supabase.from("expected_actions").update({ status: "resolved" }).eq("id", expectedActionId);
  if (error) throw new Error(error.message);
}

/** Captured remittances that still have an unexplained deduction total (for the picker). */
export async function fetchRemittanceRefs(): Promise<{ ref: string; deductions: number | null; date: string | null }[]> {
  const { data, error } = await supabase
    .from("remittances")
    .select("remittance_ref, deductions_aed, payment_date")
    .order("payment_date", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  return data.map((r) => ({ ref: r.remittance_ref, deductions: r.deductions_aed, date: r.payment_date }));
}

function draftToRow(d: DeductionDraft): Partial<RemittanceDeduction> {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    charge_type: d.charge_type,
    return_id: d.return_id.trim() || null,
    po_number: d.po_number.trim() || null,
    tle_invoice_number: d.tle_invoice_number.trim() || null,
    srt_number: d.srt_number.trim() || null,
    prt_number: d.prt_number.trim() || null,
    dispute_id: d.dispute_id.trim() || null,
    amazon_case_id: d.amazon_case_id.trim() || null,
    return_missing: d.return_missing,
    claim_amount_aed: num(d.claim_amount_aed),
    approved_amount_aed: num(d.approved_amount_aed),
    recovery_date: d.recovery_date || null,
    dispute_status: d.dispute_status || null,
    remark: d.remark.trim() || null,
  };
}

/** Add a new deduction line against a payment (open). */
export async function addDeduction(remittanceRef: string, amountAed: number | null, createdBy: string): Promise<void> {
  const { error } = await supabase
    .from("remittance_deductions")
    .insert({ remittance_ref: remittanceRef, amount_aed: amountAed, status: "open", created_by: createdBy });
  if (error) throw new Error(error.message);
}

/** Save edits to a deduction (without closing). */
export async function saveDeduction(id: string, d: DeductionDraft): Promise<void> {
  const { error } = await supabase.from("remittance_deductions").update(draftToRow(d)).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Validate + close a deduction. Throws with the missing fields if not ready. */
export async function closeDeduction(id: string, d: DeductionDraft, closedBy: string): Promise<void> {
  const missing = validateClosure(d);
  if (missing.length > 0) throw new Error(`Fill required: ${missing.join(", ")}`);
  const { error } = await supabase
    .from("remittance_deductions")
    .update({ ...draftToRow(d), status: "closed", closed_by: closedBy, closed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reopen a closed deduction. */
export async function reopenDeduction(id: string): Promise<void> {
  const { error } = await supabase
    .from("remittance_deductions")
    .update({ status: "open", closed_at: null, closed_by: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDeduction(id: string): Promise<void> {
  const { error } = await supabase.from("remittance_deductions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Build a draft from an existing row (for editing). */
export function rowToDraft(r: RemittanceDeduction): DeductionDraft {
  return {
    charge_type: (r.charge_type as ChargeType | null) ?? null,
    return_id: r.return_id ?? "",
    po_number: r.po_number ?? "",
    tle_invoice_number: r.tle_invoice_number ?? "",
    srt_number: r.srt_number ?? "",
    prt_number: r.prt_number ?? "",
    dispute_id: r.dispute_id ?? "",
    amazon_case_id: r.amazon_case_id ?? "",
    return_missing: r.return_missing ?? false,
    claim_amount_aed: r.claim_amount_aed != null ? String(r.claim_amount_aed) : "",
    approved_amount_aed: r.approved_amount_aed != null ? String(r.approved_amount_aed) : "",
    recovery_date: r.recovery_date ?? "",
    dispute_status: r.dispute_status ?? "",
    remark: r.remark ?? "",
  };
}
