import { supabase } from "@/lib/supabaseClient";

import { fetchAll } from "./load";
import { normalizeRef } from "./normalize";
import type {
  AccuracyFlags,
  Confidence,
  InvoiceLink,
  MatchReport,
  ReturnAccuracy,
  ReturnsAccuracyResult,
} from "./types";

interface ReturnRow {
  return_id: string;
  model_sku: string | null;
  tle_invoice_number: string | null;
  amazon_invoice: string | null;
  total_cost_aed: number | null;
  date_received: string | null;
  status: string | null;
}
interface InvoiceRow {
  invoice_number: string;
}

function dupKey(sku: string, invoice: string): string {
  return `${normalizeRef(sku)}|${normalizeRef(invoice)}`;
}

/**
 * Read-only accuracy analysis for returns. Links each return to an invoice via
 * `tle_invoice_number` (then `amazon_invoice`), detects duplicate SKU+invoice
 * returns, lists missing fields, and derives flags + confidence.
 */
export async function analyzeReturnsAccuracy(): Promise<ReturnsAccuracyResult> {
  const [returns, invoices] = await Promise.all([
    fetchAll<ReturnRow>((from, to) =>
      supabase
        .from("returns")
        .select(
          "return_id, model_sku, tle_invoice_number, amazon_invoice, total_cost_aed, date_received, status"
        )
        .range(from, to)
    ),
    fetchAll<InvoiceRow>((from, to) =>
      supabase.from("invoices").select("invoice_number").range(from, to)
    ),
  ]);

  const invoiceExact = new Set<string>();
  const invoiceNorm = new Set<string>();
  for (const inv of invoices) {
    invoiceExact.add(inv.invoice_number);
    invoiceNorm.add(normalizeRef(inv.invoice_number));
  }

  const dupCount = new Map<string, number>();
  for (const r of returns) {
    if (r.model_sku && r.tle_invoice_number) {
      const key = dupKey(r.model_sku, r.tle_invoice_number);
      dupCount.set(key, (dupCount.get(key) ?? 0) + 1);
    }
  }

  const now = Date.now();
  let exactMatches = 0;
  let normalizedMatches = 0;
  let unmatched = 0;
  const topUnmatched: string[] = [];

  const rows: ReturnAccuracy[] = returns.map((r) => {
    // Link: try TLE invoice, then Amazon invoice.
    let invoiceLink: InvoiceLink = "none";
    let linkedInvoiceNumber: string | null = null;
    for (const candidate of [r.tle_invoice_number, r.amazon_invoice]) {
      if (!candidate) continue;
      if (invoiceExact.has(candidate)) {
        invoiceLink = "exact";
        linkedInvoiceNumber = candidate;
        break;
      }
      if (invoiceNorm.has(normalizeRef(candidate))) {
        invoiceLink = "normalized";
        linkedInvoiceNumber = candidate;
        break;
      }
    }

    // Match report keyed on the canonical TLE invoice number.
    const primary = r.tle_invoice_number;
    if (primary && invoiceExact.has(primary)) {
      exactMatches += 1;
      normalizedMatches += 1;
    } else if (primary && invoiceNorm.has(normalizeRef(primary))) {
      normalizedMatches += 1;
    } else if (primary) {
      unmatched += 1;
      if (topUnmatched.length < 10) topUnmatched.push(primary);
    }

    const missingFields: string[] = [];
    if (!r.model_sku) missingFields.push("model_sku");
    if (!r.tle_invoice_number) missingFields.push("tle_invoice_number");
    if (!r.amazon_invoice) missingFields.push("amazon_invoice");
    if (r.total_cost_aed == null) missingFields.push("total_cost_aed");
    if (!r.date_received) missingFields.push("date_received");

    const duplicateRisk =
      !!(r.model_sku && r.tle_invoice_number) &&
      (dupCount.get(dupKey(r.model_sku as string, r.tle_invoice_number as string)) ??
        0) > 1;

    let ageDays: number | null = null;
    if (r.date_received) {
      const t = new Date(r.date_received).getTime();
      ageDays = Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000);
    }

    const hasAmount = r.total_cost_aed != null;
    const linked = invoiceLink !== "none";

    let confidence: Confidence;
    if (linked && hasAmount && !duplicateRisk) confidence = "high";
    else if (!linked && (!hasAmount || ageDays === null)) confidence = "low";
    else confidence = "medium";

    const flags: AccuracyFlags = {
      matched: linked,
      unmatched: !linked,
      amount_mismatch: false, // returns have no invoice-amount equality basis
      duplicate_reference: duplicateRisk,
      missing_invoice_link: !linked,
      needs_review:
        !linked ||
        duplicateRisk ||
        !hasAmount ||
        ageDays === null ||
        confidence === "low",
    };

    return {
      returnRef: r.return_id,
      sku: r.model_sku,
      totalCostAed: r.total_cost_aed,
      invoiceLink,
      linkedInvoiceNumber,
      duplicateRisk,
      missingFields,
      ageDays,
      status: r.status,
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
