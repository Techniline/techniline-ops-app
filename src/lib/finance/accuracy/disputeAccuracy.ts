import { supabase } from "@/lib/supabaseClient";

import { fetchAll } from "./load";
import { normalizeRef } from "./normalize";
import { effectiveInScope } from "./scope";
import { tolerance, withinTolerance } from "./tolerance";
import type {
  AccuracyFlags,
  Confidence,
  DisputeAccuracy,
  DisputeAccuracyResult,
  InvoiceLink,
  MatchReport,
} from "./types";

interface DisputeRow {
  dispute_number: string | null;
  invoice_amount_aed: number | null;
  credit_amount_aed: number | null;
  tle_invoice_number: string | null;
  payment_number: string | null;
  dispute_status: string | null;
  raised_at: string | null;
  created_at: string | null;
  resolved_at: string | null;
}
interface DisputeItemRow {
  dispute_number: string;
}
interface InvoiceRow {
  invoice_number: string;
  payment_number: string | null;
  invoice_date: string | null;
  synced_at: string | null;
}

const TERMINAL = new Set([
  "amazon_rejected",
  "amazon_partial",
  "amazon_approved",
  "resolved",
]);

/**
 * Read-only accuracy analysis for disputes. Links each dispute to an invoice
 * via `tle_invoice_number` (exact then normalized), uses `payment_number` as a
 * secondary link signal, derives recovery status from `dispute_status` (NOT the
 * constant `approval_status`), and flags over-credits and sparse items.
 */
export async function analyzeDisputeAccuracy(): Promise<DisputeAccuracyResult> {
  const [allDisputes, items, allInvoices] = await Promise.all([
    fetchAll<DisputeRow>((from, to) =>
      supabase
        .from("disputes")
        .select(
          "dispute_number, invoice_amount_aed, credit_amount_aed, tle_invoice_number, payment_number, dispute_status, raised_at, created_at, resolved_at"
        )
        .range(from, to)
    ),
    fetchAll<DisputeItemRow>((from, to) =>
      supabase.from("dispute_items").select("dispute_number").range(from, to)
    ),
    fetchAll<InvoiceRow>((from, to) =>
      supabase
        .from("invoices")
        .select("invoice_number, payment_number, invoice_date, synced_at")
        .range(from, to)
    ),
  ]);

  // Scope: 2025+ only.
  const disputes = allDisputes.filter((d) =>
    effectiveInScope(d.raised_at, d.created_at)
  );
  const invoices = allInvoices.filter((i) =>
    effectiveInScope(i.invoice_date, i.synced_at)
  );
  const scopedDisputeNumbers = new Set(
    disputes
      .map((d) => d.dispute_number)
      .filter((n): n is string => n != null)
  );

  const invoiceExact = new Set<string>();
  const invoiceNorm = new Set<string>();
  const paymentNorm = new Set<string>();
  for (const inv of invoices) {
    invoiceExact.add(inv.invoice_number);
    invoiceNorm.add(normalizeRef(inv.invoice_number));
    if (inv.payment_number) paymentNorm.add(normalizeRef(inv.payment_number));
  }

  const itemCount = new Map<string, number>();
  for (const it of items) {
    if (!scopedDisputeNumbers.has(it.dispute_number)) continue; // inherit parent scope
    itemCount.set(it.dispute_number, (itemCount.get(it.dispute_number) ?? 0) + 1);
  }

  const dnumCount = new Map<string, number>();
  for (const d of disputes) {
    if (d.dispute_number)
      dnumCount.set(d.dispute_number, (dnumCount.get(d.dispute_number) ?? 0) + 1);
  }

  let exactMatches = 0;
  let normalizedMatches = 0;
  let unmatched = 0;
  const topUnmatched: string[] = [];

  const rows: DisputeAccuracy[] = disputes.map((d) => {
    const tle = d.tle_invoice_number;
    let invoiceLink: InvoiceLink = "none";
    let linkedInvoiceNumber: string | null = null;
    if (tle && invoiceExact.has(tle)) {
      invoiceLink = "exact";
      linkedInvoiceNumber = tle;
    } else if (tle && invoiceNorm.has(normalizeRef(tle))) {
      invoiceLink = "normalized";
      linkedInvoiceNumber = tle;
    }

    const hasPaymentLink =
      !!d.payment_number && paymentNorm.has(normalizeRef(d.payment_number));

    // Match report keyed on TLE invoice number.
    if (tle && invoiceExact.has(tle)) {
      exactMatches += 1;
      normalizedMatches += 1;
    } else if (tle && invoiceNorm.has(normalizeRef(tle))) {
      normalizedMatches += 1;
    } else if (tle) {
      unmatched += 1;
      if (topUnmatched.length < 10) topUnmatched.push(tle);
    }

    const invAmt = d.invoice_amount_aed;
    const credit = d.credit_amount_aed;
    const variance = invAmt != null && credit != null ? invAmt - credit : null;
    const withinTol =
      invAmt != null && credit != null ? withinTolerance(invAmt, credit) : false;
    const overCredit =
      invAmt != null && credit != null && credit > invAmt + tolerance(invAmt);

    const status = (d.dispute_status ?? "").toLowerCase();
    let recoveryStatus: string;
    if (status === "amazon_rejected") recoveryStatus = "rejected";
    else if (status === "amazon_partial") recoveryStatus = "partial";
    else if ((status === "amazon_approved" || status === "resolved") && (credit ?? 0) > 0)
      recoveryStatus = "recovered";
    else if (status === "open") recoveryStatus = "open";
    else recoveryStatus = d.dispute_status ?? "unknown";

    const disputeItemsCount = d.dispute_number
      ? itemCount.get(d.dispute_number) ?? 0
      : 0;
    const duplicate = d.dispute_number
      ? (dnumCount.get(d.dispute_number) ?? 0) > 1
      : false;
    const linked = invoiceLink !== "none" || hasPaymentLink;
    const terminal = TERMINAL.has(status);

    let confidence: Confidence;
    if (terminal && invAmt != null && credit != null && linked) confidence = "high";
    else if (status !== "" && status !== "open") confidence = "medium";
    else confidence = "low";

    const flags: AccuracyFlags = {
      matched: linked,
      unmatched: !linked,
      amount_mismatch: overCredit,
      duplicate_reference: duplicate,
      missing_invoice_link: !linked,
      needs_review:
        !linked ||
        overCredit ||
        recoveryStatus === "open" ||
        duplicate ||
        confidence === "low",
    };

    return {
      disputeNumber: d.dispute_number ?? "—",
      invoiceAmount: invAmt,
      creditAmount: credit,
      variance,
      withinTolerance: withinTol,
      invoiceLink,
      linkedInvoiceNumber,
      disputeItemsCount,
      recoveryStatus,
      flags,
      confidence,
    };
  });

  const matchReport: MatchReport = {
    exactMatches,
    normalizedMatches,
    additionalFromNormalization: normalizedMatches - exactMatches,
    unmatched,
    topUnmatched,
  };

  return { rows, matchReport };
}
