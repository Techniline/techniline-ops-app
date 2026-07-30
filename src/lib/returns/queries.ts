import { supabase } from "@/lib/supabaseClient";
import { chargeTypeLabel } from "@/lib/remittanceDeductions";

import type { ReturnRow } from "./types";

export async function fetchReturns(): Promise<ReturnRow[]> {
  const { data, error } = await supabase
    .from("returns")
    .select("*")
    .order("date_received", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ReturnType = "vendor_return" | "return_dispute" | "shortage_claim" | "price_claim";

export const RETURN_TYPES: { value: ReturnType; label: string }[] = [
  { value: "vendor_return", label: "Vendor Return" },
  { value: "return_dispute", label: "Return Dispute" },
  { value: "shortage_claim", label: "Shortage Claim" },
  { value: "price_claim", label: "Price Claim (PRT)" },
];

export interface ReturnDraft {
  return_type: ReturnType | null;
  return_date: string;
  return_id: string;
  vret_number: string;
  authorization_id: string;
  warehouse: string;
  amazon_invoice: string;
  po_number: string;
  tle_invoice_number: string;
  model_sku: string;
  qty: string;
  amount: string;
  srt_number: string;
  prt_number: string;
  dispute_id: string;
  amazon_case_id: string;
  tracking_number: string;
  comments: string;
}

const has = (s: string) => Boolean(s && s.trim());

export function returnFieldsFor(t: ReturnType | null): {
  po: boolean; tle: boolean; srt: boolean; prt: boolean; dispute: boolean; caseId: boolean;
} {
  switch (t) {
    case "vendor_return":  return { po: true,  tle: true,  srt: true,  prt: true,  dispute: false, caseId: true  };
    case "return_dispute": return { po: true,  tle: true,  srt: false, prt: false, dispute: true,  caseId: true  };
    case "shortage_claim": return { po: false, tle: false, srt: true,  prt: false, dispute: true,  caseId: true  };
    case "price_claim":    return { po: false, tle: false, srt: false, prt: true,  dispute: false, caseId: false };
    default:               return { po: false, tle: false, srt: false, prt: false, dispute: false, caseId: false };
  }
}

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
    if (!has(d.srt_number) && !has(d.dispute_id) && !has(d.amazon_case_id))
      miss.push("SRT # or Dispute ID or Case ID");
  }
  if (d.return_type === "price_claim") {
    if (!has(d.prt_number)) miss.push("PRT Number");
  }
  return miss;
}

// ── Write helpers ────────────────────────────────────────────────────────────

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const str = (s: string) => s.trim() || null;

function buildPayload(d: ReturnDraft, fallbackId?: string) {
  const returnId =
    d.return_id.trim() ||
    d.srt_number.trim() ||
    d.prt_number.trim() ||
    d.dispute_id.trim() ||
    d.amazon_case_id.trim() ||
    fallbackId ||
    `RET-${new Date().toISOString().slice(0, 19).replace(/[:T-]/g, "")}`;
  return {
    return_id: returnId,
    return_type: d.return_type,
    date_received: d.return_date.trim() || new Date().toISOString().slice(0, 10),
    vret_number: str(d.vret_number),
    authorization_id: str(d.authorization_id),
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
  };
}

export async function logReturn(d: ReturnDraft, loggedBy: string): Promise<void> {
  const missing = validateReturn(d);
  if (missing.length > 0) throw new Error(`Fill required: ${missing.join(", ")}`);
  const { error } = await supabase.from("returns").insert({
    ...buildPayload(d),
    source: "manual",
    status: "open",
    logged_by: loggedBy,
  });
  if (error) throw new Error(error.message);
}

export async function updateReturn(dbId: string, d: ReturnDraft): Promise<void> {
  const { error } = await supabase
    .from("returns")
    .update(buildPayload(d, dbId))
    .eq("id", dbId);
  if (error) throw new Error(error.message);
}

// ── Unified view ─────────────────────────────────────────────────────────────

export interface UnifiedReturn {
  id: string;
  dbId: string | null;           // raw DB UUID — present for manual rows, null for remittance
  source: "email" | "remittance" | "manual";
  date: string | null;
  returnId: string | null;       // Shipment Request ID (VRET…)
  vretNumber: string | null;     // numeric Return ID
  authorizationId: string | null;
  reference: string | null;      // Amazon invoice #
  warehouse: string | null;
  sku: string | null;
  qty: number | null;
  poNumber: string | null;
  erpInvoice: string | null;
  returnType: ReturnType | null;
  type: string | null;           // display label
  amount: number | null;
  recovery: number | null;
  status: string | null;
  srtNumber: string | null;
  prtNumber: string | null;
  disputeId: string | null;
  caseId: string | null;
  trackingNumber: string | null;
  comments: string | null;
}

export async function fetchCombinedReturns(): Promise<UnifiedReturn[]> {
  const [emailRes, dedRes] = await Promise.all([
    supabase.from("returns").select("*").in("source", ["manual", "amazon_csv"]).order("date_received", { ascending: false }).limit(500),
    supabase
      .from("remittance_deductions")
      .select("*")
      .in("charge_type", ["vendor_return", "return_dispute", "shortage_claim"])
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const returns = (emailRes.data ?? []) as ReturnRow[];
  const returnIds = returns.map((r) => r.return_id).filter(Boolean) as string[];

  // Collect all dispute numbers referenced by these returns (two paths):
  // Path A: returns.dispute_id_ref (manually entered dispute link)
  // Path B: dispute_items.return_id → dispute_number (import-linked)
  const disputeNumsFromRef = returns
    .map((r) => r.dispute_id_ref)
    .filter(Boolean) as string[];

  // Build recovery map: return_id → best available approved/recovered amount
  const recoveryByReturnId = new Map<string, number>();
  // Also map dispute_number → approved_amount_aed for Path A lookups
  const approvedByDisp = new Map<string, number>();

  // Collect all dispute numbers we need to look up
  const allDisputeNums = new Set<string>(disputeNumsFromRef);

  // Path B: dispute_items for numeric return IDs
  let dispItems: Array<{ return_id: string | null; dispute_number: string | null; line_amount_aed: number | null }> = [];
  if (returnIds.length > 0) {
    const { data } = await supabase
      .from("dispute_items")
      .select("return_id, dispute_number, line_amount_aed")
      .in("return_id", returnIds);
    dispItems = data ?? [];
    for (const item of dispItems) {
      if (item.dispute_number) allDisputeNums.add(item.dispute_number);
    }
  }

  // Fetch all disputes in one query
  if (allDisputeNums.size > 0) {
    const { data: disputes } = await supabase
      .from("disputes")
      .select("dispute_number, approved_amount_aed, return_ids")
      .in("dispute_number", [...allDisputeNums]);

    const countByDisp = new Map<string, number>();
    for (const d of disputes ?? []) {
      if (!d.dispute_number || d.approved_amount_aed == null) continue;
      approvedByDisp.set(d.dispute_number, d.approved_amount_aed);
      const linkedCount = d.return_ids ? d.return_ids.split(",").filter(Boolean).length : 1;
      countByDisp.set(d.dispute_number, linkedCount);
    }

    // Path B: dispute_items with per-line or prorated amount
    for (const item of dispItems) {
      if (!item.return_id || !item.dispute_number) continue;
      let recovered: number | null = item.line_amount_aed;
      if (recovered == null) {
        const total = approvedByDisp.get(item.dispute_number) ?? null;
        const count = countByDisp.get(item.dispute_number) ?? 1;
        recovered = total != null ? Math.round((total / count) * 100) / 100 : null;
      }
      if (recovered != null) {
        recoveryByReturnId.set(item.return_id, (recoveryByReturnId.get(item.return_id) ?? 0) + recovered);
      }
    }
  }

  // Remittance deduction approved amounts (fallback)
  if (returnIds.length > 0) {
    const { data: dedApprovals } = await supabase
      .from("remittance_deductions")
      .select("return_id, approved_amount_aed")
      .in("return_id", returnIds)
      .not("approved_amount_aed", "is", null);

    for (const d of dedApprovals ?? []) {
      if (!d.return_id || d.approved_amount_aed == null) continue;
      if (!recoveryByReturnId.has(d.return_id)) {
        recoveryByReturnId.set(d.return_id, d.approved_amount_aed);
      }
    }
  }

  const out: UnifiedReturn[] = [];

  for (const r of returns) {
    const rx = r as unknown as Record<string, unknown>;
    // Priority: manually entered > dispute_items join > direct dispute_id_ref > remittance deduction
    const disputeRefApproved = r.dispute_id_ref ? (approvedByDisp.get(r.dispute_id_ref) ?? null) : null;
    const computedRecovery =
      r.recovery_amt_aed ??
      recoveryByReturnId.get(r.return_id ?? "") ??
      disputeRefApproved ??
      null;

    // Derive display status: DB status takes priority, then fall back to
    // the computed recovery amount so rows update even before a dispute import.
    const dbStatus = r.dispute_status_text ?? r.status ?? "open";
    const displayStatus =
      dbStatus === "recovered" ? "Recovered" :
      dbStatus === "rejected"  ? "Rejected"  :
      computedRecovery != null && computedRecovery > 0 ? "Recovered" :
      "Open";

    out.push({
      id: `e_${r.id}`,
      dbId: r.id,
      source: r.source === "manual" || r.source === "amazon_csv" ? "manual" : "email",
      date: r.date_received ?? r.created_at ?? null,
      returnId: r.return_id ?? null,
      vretNumber: r.vret_number ?? null,
      authorizationId: (rx["authorization_id"] as string | null) ?? null,
      reference: r.amazon_invoice ?? null,
      warehouse: r.warehouse ?? null,
      sku: r.model_sku ?? null,
      qty: r.qty ?? null,
      poNumber: r.po_number ?? null,
      erpInvoice: r.tle_invoice_number ?? null,
      returnType: (r.return_type as ReturnType | null) ?? null,
      type: r.return_type ?? "Return",
      amount: r.total_cost_aed ?? r.refund_aed ?? r.recovery_amt_aed ?? null,
      recovery: computedRecovery,
      status: displayStatus,
      srtNumber: r.srt_number ?? null,
      prtNumber: r.prt_number ?? null,
      disputeId: r.dispute_id_ref ?? null,
      caseId: r.amazon_case_id ?? null,
      trackingNumber: (rx["tracking_number"] as string | null) ?? null,
      comments: r.comments ?? null,
    });
  }

  for (const d of dedRes.data ?? []) {
    out.push({
      id: `r_${d.id}`,
      dbId: null,
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
      returnType: null,
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
