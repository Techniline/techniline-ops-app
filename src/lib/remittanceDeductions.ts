import { formatAED } from "@/lib/format";
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
  "Recovered",
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

// ── Recovery analytics + export ──────────────────────────────────────────────

const abs = (n: number | null | undefined) => Math.abs(n ?? 0);

export interface RecoverySummary {
  totalDeducted: number; // Σ |amount_aed|
  totalClaimed: number; // Σ claim_amount_aed
  totalApproved: number; // Σ approved_amount_aed (recovered)
  recoveryPct: number | null; // approved ÷ claimed
  openCount: number;
  closedCount: number;
  byChargeType: { type: string; label: string; count: number; deducted: number; approved: number }[];
  byStatus: { status: string; count: number; claimed: number; approved: number }[];
  byMonth: { month: string; deducted: number; approved: number }[];
  aging: { bucket: string; count: number; amount: number }[]; // OPEN deductions by age
}

/** Aggregate recovery metrics from the deduction set (pass includeClosed: true). */
export function summarizeRecovery(ds: RemittanceDeduction[]): RecoverySummary {
  let totalDeducted = 0, totalClaimed = 0, totalApproved = 0, openCount = 0, closedCount = 0;
  const ct = new Map<string, { count: number; deducted: number; approved: number }>();
  const st = new Map<string, { count: number; claimed: number; approved: number }>();
  const mo = new Map<string, { deducted: number; approved: number }>();
  const aging = [
    { bucket: "0–30 days", count: 0, amount: 0 },
    { bucket: "31–60 days", count: 0, amount: 0 },
    { bucket: "61–90 days", count: 0, amount: 0 },
    { bucket: "90+ days", count: 0, amount: 0 },
  ];
  const now = Date.now();
  for (const d of ds) {
    const ded = abs(d.amount_aed);
    totalDeducted += ded;
    totalClaimed += d.claim_amount_aed ?? 0;
    totalApproved += d.approved_amount_aed ?? 0;
    if (d.status === "closed") closedCount += 1; else openCount += 1;

    const ckey = d.charge_type ?? "uncategorized";
    const c = ct.get(ckey) ?? { count: 0, deducted: 0, approved: 0 };
    c.count += 1; c.deducted += ded; c.approved += d.approved_amount_aed ?? 0;
    ct.set(ckey, c);

    const skey = d.dispute_status ?? "—";
    const s = st.get(skey) ?? { count: 0, claimed: 0, approved: 0 };
    s.count += 1; s.claimed += d.claim_amount_aed ?? 0; s.approved += d.approved_amount_aed ?? 0;
    st.set(skey, s);

    const when = d.recovery_date ?? d.created_at;
    const month = when ? String(when).slice(0, 7) : "—";
    const m = mo.get(month) ?? { deducted: 0, approved: 0 };
    m.deducted += ded; m.approved += d.approved_amount_aed ?? 0;
    mo.set(month, m);

    if (d.status !== "closed" && d.created_at) {
      const age = (now - new Date(d.created_at).getTime()) / 86_400_000;
      const b = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
      aging[b].count += 1; aging[b].amount += ded;
    }
  }
  return {
    totalDeducted, totalClaimed, totalApproved,
    recoveryPct: totalClaimed > 0 ? Math.round((totalApproved / totalClaimed) * 100) : null,
    openCount, closedCount,
    byChargeType: [...ct.entries()].map(([type, v]) => ({ type, label: chargeTypeLabel(type), ...v })).sort((a, b) => b.deducted - a.deducted),
    byStatus: [...st.entries()].map(([status, v]) => ({ status, ...v })).sort((a, b) => b.count - a.count),
    byMonth: [...mo.entries()].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month)),
    aging,
  };
}

/** Deductions as a flat report table (for CSV export). */
export function deductionsReport(ds: RemittanceDeduction[]): { headers: string[]; rows: (string | number | null)[][] } {
  const headers = [
    "Payment Ref", "Charge Type", "Deduction AED", "Status", "Dispute Status",
    "Return ID", "PO Number", "TLE Invoice", "SRT", "PRT", "Dispute ID", "Amazon Case",
    "Claim AED", "Approved AED", "Recovery %", "Recovery Date", "Remark", "Created", "Closed",
  ];
  const rows = ds.map((d) => [
    d.remittance_ref, chargeTypeLabel(d.charge_type), d.amount_aed, d.status, d.dispute_status,
    d.return_id, d.po_number, d.tle_invoice_number, d.srt_number, d.prt_number, d.dispute_id, d.amazon_case_id,
    d.claim_amount_aed, d.approved_amount_aed, recoveryPct(d.claim_amount_aed, d.approved_amount_aed),
    d.recovery_date, d.remark, d.created_at ? String(d.created_at).slice(0, 10) : null,
    d.closed_at ? String(d.closed_at).slice(0, 10) : null,
  ]);
  return { headers, rows };
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

// Start tracking remittances from this date forward (no historical backlog) —
// but payments with open deductions always show regardless (see the band).
export const REMITTANCE_START = "2026-06-10";

/** Ingested remittance payments still needing review (from the Amazon-actions feed). */
export async function fetchOpenRemittancePayments(): Promise<RemittancePayment[]> {
  // Reviewed payments are tracked on remittances.reconciled (isolated per payment),
  // NOT on expected_actions.status — so reviewing one never affects others.
  const [{ data, error }, reconciledRes] = await Promise.all([
    supabase
      .from("expected_actions")
      .select("id, ref_number, aed_amount, email_received_at, email_subject, status, type")
      .eq("type", "remittance")
      .order("email_received_at", { ascending: false }),
    supabase.from("remittances").select("remittance_ref").eq("reconciled", true),
  ]);
  if (error || !data) return [];
  const reviewed = new Set((reconciledRes.data ?? []).map((r) => r.remittance_ref));
  return data
    .filter(
      (r) =>
        r.ref_number &&
        /^\d{6,13}$/.test(r.ref_number) && // real Amazon payment numbers only; cap at 13 to exclude 14-15 digit Return IDs
        !reviewed.has(r.ref_number) // hide only payments explicitly marked reviewed
    )
    .map((r) => ({
      id: r.id as string,
      ref: r.ref_number as string,
      amount: r.aed_amount as number | null,
      receivedAt: r.email_received_at as string | null,
      subject: r.email_subject as string | null,
    }));
}

export type RemittanceLine = Tables<"remittance_lines">;

/** The full invoice breakdown for a payment (auto-parsed from the email). */
export async function fetchRemittanceLines(ref: string): Promise<RemittanceLine[]> {
  const { data, error } = await supabase
    .from("remittance_lines")
    .select("*")
    .eq("remittance_ref", ref)
    .not("invoice_date", "is", null) // guard: never show stray header/junk lines
    .order("amount_paid_aed", { ascending: true }); // negatives (deductions) first
  if (error) return [];
  return data ?? [];
}

/** Slim return data needed for auto-notes on remittance breakdown lines. */
export interface ReturnSummary {
  return_id: string | null;
  return_type: string | null;
  srt_number: string | null;
  prt_number: string | null;
  dispute_id_ref: string | null;
  amazon_case_id: string | null;
  po_number: string | null;
  vret_number: string | null;
  recovery_amt_aed: number | null;
}

/**
 * Fetch returns keyed by amazon_invoice and tle_invoice_number for auto-note lookup.
 * Also indexes suffix-stripped variants so WS2601417SC matches a return for WS2601417.
 */
export async function fetchReturnsByInvoice(invoiceNumbers: string[]): Promise<Map<string, ReturnSummary>> {
  if (invoiceNumbers.length === 0) return new Map();
  // Normalise: also try without trailing SC / R1 / R2 suffixes
  const normalized = [...new Set([
    ...invoiceNumbers,
    ...invoiceNumbers.map((n) => n.replace(/(?:SC|R\d+)$/i, "")),
  ])].filter(Boolean);
  const { data, error } = await supabase
    .from("returns")
    .select("return_id, return_type, srt_number, prt_number, dispute_id_ref, amazon_case_id, po_number, vret_number, recovery_amt_aed, amazon_invoice, tle_invoice_number")
    .or(`amazon_invoice.in.(${normalized.join(",")}),tle_invoice_number.in.(${normalized.join(",")})`)
    .limit(200);
  if (error) console.error("[fetchReturnsByInvoice] query error:", error);
  console.log("[fetchReturnsByInvoice] rows returned:", data?.length ?? 0, "for", invoiceNumbers.length, "invoices");

  const map = new Map<string, ReturnSummary>();
  for (const r of data ?? []) {
    const rec: ReturnSummary = {
      return_id: r.return_id ?? null,
      return_type: r.return_type ?? null,
      srt_number: r.srt_number ?? null,
      prt_number: r.prt_number ?? null,
      dispute_id_ref: r.dispute_id_ref ?? null,
      amazon_case_id: r.amazon_case_id ?? null,
      po_number: r.po_number ?? null,
      vret_number: r.vret_number ?? null,
      recovery_amt_aed: r.recovery_amt_aed ?? null,
    };
    if (r.amazon_invoice) map.set(r.amazon_invoice, rec);
    if (r.tle_invoice_number) map.set(r.tle_invoice_number, rec);
  }
  // Map original suffixed invoice numbers → matched base record
  for (const inv of invoiceNumbers) {
    if (!map.has(inv)) {
      const base = inv.replace(/(?:SC|R\d+)$/i, "");
      const match = map.get(base);
      if (match) map.set(inv, match);
    }
  }
  return map;
}

/** Manager/Maricel-triggered live re-ingest of Amazon emails (no secret needed). */
export async function triggerReingest(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/amazon/reingest", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean; error?: string; fetched?: number; written?: number; errors?: number;
    items?: Array<{ type: string; subject?: string | null; lineOps?: number; opErrors?: number; firstOpError?: string; notes?: string[] }>;
  };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  // Surface the remittance email's parse outcome so issues are visible.
  const rem = (j.items ?? []).find((i) => i.type === "remittance");
  if (rem) {
    if (rem.firstOpError) return `Synced, but a write failed: ${rem.firstOpError}`;
    if ((rem.lineOps ?? 0) === 0) return `Synced — but no invoice lines were parsed from the email body. ${rem.notes?.join(" ") ?? ""}`.trim();
    return `Synced — ${rem.lineOps} invoice line(s) parsed${rem.opErrors ? `, ${rem.opErrors} write error(s)` : ""}.`;
  }
  return `Email sync complete (${j.written ?? 0} written, ${j.errors ?? 0} errors).`;
}

/** Re-fetch remittance emails from Outlook (90-day window) and re-ingest with the 9-column parser. */
export async function triggerReparseLines(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/amazon/reparse-lines", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; remittances?: number; linesReparsed?: number; writeErrors?: number; errors?: number };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return `Re-synced ${j.remittances ?? 0} remittance email(s), ${j.linesReparsed ?? 0} line(s) repopulated${j.writeErrors ? ` (${j.writeErrors} write errors)` : ""}.`;
}

/** Accounts team: mark a remittance line as settled in the books (toggles). */
export async function markLineSettled(lineId: string, settled: boolean): Promise<void> {
  const { error } = await supabase
    .from("remittance_lines")
    .update({ settled_at: settled ? new Date().toISOString() : null })
    .eq("id", lineId);
  if (error) throw new Error(error.message);
}

/** Save a per-line reconciliation remark (any line, not just negatives). */
export async function saveLineRemark(lineId: string, remark: string): Promise<void> {
  const { error } = await supabase
    .from("remittance_lines")
    .update({ recon_remark: remark.trim() || null })
    .eq("id", lineId);
  if (error) throw new Error(error.message);
}

/** Compose the reconciliation email HTML for accounts: full breakdown + ops reasons. */
export function buildReconEmailHtml(
  payment: RemittancePayment,
  lines: RemittanceLine[],
  deductions: RemittanceDeduction[]
): string {
  const dedByKey = new Map(deductions.filter((d) => d.source_line_key).map((d) => [d.source_line_key as string, d]));
  const fmt = (n: number | null) => (n == null ? "—" : formatAED(n));
  const rows = lines
    .map((l) => {
      const neg = (l.amount_paid_aed ?? 0) < 0;
      const ded = dedByKey.get(`${payment.ref}:${l.invoice_number}`);
      const reasonBits = [
        ded?.charge_type ? chargeTypeLabel(ded.charge_type) : null,
        ded?.return_id ? `Return ${ded.return_id}` : null,
        ded?.srt_number ? `SRT ${ded.srt_number}` : null,
        ded?.prt_number ? `PRT ${ded.prt_number}` : null,
        ded?.dispute_id ? `Dispute ${ded.dispute_id}` : null,
        ded?.amazon_case_id ? `Case ${ded.amazon_case_id}` : null,
        ded?.po_number ? `PO ${ded.po_number}` : null,
        ded?.tle_invoice_number ? `TLE ${ded.tle_invoice_number}` : null,
        ded?.approved_amount_aed != null ? `Approved AED ${ded.approved_amount_aed}` : null,
        ded?.remark ?? null,
        l.recon_remark ?? null,
      ].filter(Boolean);
      const reason = reasonBits.length ? reasonBits.join(" · ") : "";
      const amtStyle = neg ? "color:#b91c1c;font-weight:bold" : "";
      return `<tr>
        <td style="padding:4px 8px;border-top:1px solid #eee">${l.invoice_number ?? ""}${l.partial ? " *" : ""}</td>
        <td style="padding:4px 8px;border-top:1px solid #eee">${l.invoice_date ?? ""}</td>
        <td style="padding:4px 8px;border-top:1px solid #eee">${l.description ?? ""}</td>
        <td style="padding:4px 8px;border-top:1px solid #eee;text-align:right;${amtStyle}">${fmt(l.amount_paid_aed)}</td>
        <td style="padding:4px 8px;border-top:1px solid #eee;text-align:right">${fmt(l.amount_remaining_aed)}</td>
        <td style="padding:4px 8px;border-top:1px solid #eee">${reason}</td>
      </tr>`;
    })
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111">
    <h2 style="margin:0 0 2px">Remittance reconciliation — Payment ${payment.ref}</h2>
    <p style="margin:0 0 12px;color:#666">${payment.receivedAt ? payment.receivedAt.slice(0,10) : ""}${payment.amount != null ? ` · Net paid ${formatAED(payment.amount)}` : ""}</p>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-size:12px">
      <thead><tr style="background:#f1f5f9;text-align:left">
        <th style="padding:6px 8px">Invoice</th><th style="padding:6px 8px">Date</th>
        <th style="padding:6px 8px">Description</th><th style="padding:6px 8px;text-align:right">Amount Paid</th>
        <th style="padding:6px 8px;text-align:right">Remaining</th><th style="padding:6px 8px">Reason / how to settle</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:12px 0 0;color:#999;font-size:11px">Negative (red) amounts are deductions Amazon took back. "*" = partially paid / previously deducted. Generated from Techniline Ops.</p>
  </div>`;
}

/** Send the reconciliation email (To + CC) via the server route. */
export async function emailReconciliation(args: { to: string; cc: string; subject: string; html: string }): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/remittance/email", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}

/** Mark a remittance payment reviewed — isolated flag on the remittances row for
 *  THIS payment ref only (never touches expected_actions or other payments). */
export async function markRemittanceReviewed(remittanceRef: string): Promise<void> {
  if (!remittanceRef) throw new Error("Missing payment reference.");
  const { error } = await supabase
    .from("remittances")
    .update({ reconciled: true, reviewed_at: new Date().toISOString() })
    .eq("remittance_ref", remittanceRef);
  if (error) {
    // reviewed_at column may not exist yet (migration not run) — retry without it
    // so "Mark reviewed" always works.
    const { error: e2 } = await supabase
      .from("remittances")
      .update({ reconciled: true })
      .eq("remittance_ref", remittanceRef);
    if (e2) throw new Error(e2.message);
  }
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
