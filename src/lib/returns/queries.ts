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

/** A return from either source, normalised for the monthly Returns view. */
export interface UnifiedReturn {
  id: string;
  source: "email" | "remittance";
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
      .in("charge_type", ["vendor_return", "return_dispute"])
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const out: UnifiedReturn[] = [];

  for (const r of (emailRes.data ?? []) as ReturnRow[]) {
    out.push({
      id: `e_${r.id}`,
      source: "email",
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
