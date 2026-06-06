import { supabase } from "@/lib/supabaseClient";

import { fetchAll } from "./load";
import { normalizeRef } from "./normalize";
import { effectiveInScope } from "./scope";
import { withinTolerance } from "./tolerance";
import type {
  AccuracyFlags,
  Confidence,
  MatchReport,
  RemittanceAccuracy,
  RemittanceAccuracyResult,
} from "./types";

const PAYABLE = "invoice_payable";

interface RemittanceRow {
  remittance_ref: string;
  payment_date: string | null;
  created_at: string | null;
  gross_amount_aed: number | null;
  deductions_aed: number | null;
  net_paid_aed: number | null;
}
interface LineRow {
  remittance_ref: string;
  invoice_number: string | null;
  transaction_type: string | null;
}
interface InvoiceRow {
  invoice_number: string;
  invoice_date: string | null;
  synced_at: string | null;
}

/**
 * Read-only accuracy analysis for remittances (2025+ scope). Links payable
 * lines to in-scope invoices (exact then normalized), computes header variance,
 * and derives flags + confidence. Ignores stored `match_status`.
 */
export async function analyzeRemittanceAccuracy(): Promise<RemittanceAccuracyResult> {
  const [allRemittances, lines, allInvoices] = await Promise.all([
    fetchAll<RemittanceRow>((from, to) =>
      supabase
        .from("remittances")
        .select(
          "remittance_ref, payment_date, created_at, gross_amount_aed, deductions_aed, net_paid_aed"
        )
        .range(from, to)
    ),
    fetchAll<LineRow>((from, to) =>
      supabase
        .from("remittance_lines")
        .select("remittance_ref, invoice_number, transaction_type")
        .range(from, to)
    ),
    fetchAll<InvoiceRow>((from, to) =>
      supabase
        .from("invoices")
        .select("invoice_number, invoice_date, synced_at")
        .range(from, to)
    ),
  ]);

  // Scope: 2025+ only.
  const remittances = allRemittances.filter((r) =>
    effectiveInScope(r.payment_date, r.created_at)
  );
  const invoices = allInvoices.filter((i) =>
    effectiveInScope(i.invoice_date, i.synced_at)
  );

  const invoiceExact = new Set<string>();
  const invoiceNorm = new Set<string>();
  for (const inv of invoices) {
    invoiceExact.add(inv.invoice_number);
    invoiceNorm.add(normalizeRef(inv.invoice_number));
  }

  const scopedRefs = new Set(remittances.map((r) => r.remittance_ref));
  const payableByRef = new Map<string, (string | null)[]>();
  for (const line of lines) {
    if (line.transaction_type !== PAYABLE) continue;
    if (!scopedRefs.has(line.remittance_ref)) continue; // inherit parent scope
    const arr = payableByRef.get(line.remittance_ref) ?? [];
    arr.push(line.invoice_number);
    payableByRef.set(line.remittance_ref, arr);
  }

  const refCount = new Map<string, number>();
  for (const r of remittances) {
    refCount.set(r.remittance_ref, (refCount.get(r.remittance_ref) ?? 0) + 1);
  }

  let exactMatches = 0;
  let normalizedMatches = 0;
  let unmatched = 0;
  const topUnmatched: string[] = [];

  const rows: RemittanceAccuracy[] = remittances.map((r) => {
    const payable = payableByRef.get(r.remittance_ref) ?? [];
    let linked = 0;
    for (const invNo of payable) {
      if (invNo && invoiceExact.has(invNo)) {
        exactMatches += 1;
        normalizedMatches += 1;
        linked += 1;
      } else if (invNo && invoiceNorm.has(normalizeRef(invNo))) {
        normalizedMatches += 1;
        linked += 1;
      } else {
        unmatched += 1;
        if (invNo && topUnmatched.length < 10) topUnmatched.push(invNo);
      }
    }

    const payableLineCount = payable.length;
    const linkedPayableCount = linked;
    const unmatchedPayableCount = payableLineCount - linked;
    const linkedPercentage =
      payableLineCount === 0
        ? 100
        : Math.round((linked / payableLineCount) * 100);

    const expectedNet = (r.gross_amount_aed ?? 0) - (r.deductions_aed ?? 0);
    const headerVariance = expectedNet - (r.net_paid_aed ?? 0);
    const withinHeaderTolerance = withinTolerance(expectedNet, r.net_paid_aed ?? 0);

    const duplicate = (refCount.get(r.remittance_ref) ?? 0) > 1;
    const missingLink = unmatchedPayableCount > 0;
    const amountMismatch = !withinHeaderTolerance;
    const isMatched =
      payableLineCount > 0 && unmatchedPayableCount === 0 && withinHeaderTolerance;
    const isUnmatched = payableLineCount > 0 && linkedPayableCount === 0;

    let confidence: Confidence;
    if (withinHeaderTolerance && linkedPercentage >= 95) confidence = "high";
    else if (linkedPercentage >= 60 || Math.abs(headerVariance) <= 10)
      confidence = "medium";
    else confidence = "low";

    const flags: AccuracyFlags = {
      matched: isMatched,
      unmatched: isUnmatched,
      amount_mismatch: amountMismatch,
      duplicate_reference: duplicate,
      missing_invoice_link: missingLink,
      needs_review:
        amountMismatch ||
        missingLink ||
        isUnmatched ||
        duplicate ||
        confidence === "low",
    };

    return {
      remittanceRef: r.remittance_ref,
      paymentDate: r.payment_date,
      gross: r.gross_amount_aed,
      deductions: r.deductions_aed,
      net: r.net_paid_aed,
      headerVariance,
      withinHeaderTolerance,
      payableLineCount,
      linkedPayableCount,
      unmatchedPayableCount,
      linkedPercentage,
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
