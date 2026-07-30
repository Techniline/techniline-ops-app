import { amountNear, combinedText, DEFAULT_ASSIGNEE_ID, matchOne } from "./detectType";
import { parseRemittanceTable } from "./remittanceTable";
import type {
  ExpectedActionInsert,
  IngestPayload,
  ParseResult,
  RemittanceInsert,
  UpsertOperation,
} from "./types";

export function parseRemittance(payload: IngestPayload): ParseResult {
  const text = combinedText(payload);

  // Parse the invoice line table straight from the HTML body (reliable structure).
  const parsed = parseRemittanceTable(payload.bodyText);

  // Prefer the explicit "Payment number: <digits>" from the table; fall back to text.
  // The alphanumeric-ref fallback requires 3+ digits to avoid capturing English words
  // like "information" or "Advice" from subject lines like "Remittance information".
  const _alphaRef = matchOne(text, /remittance[\s#:-]*(?:ref|number|id)?[\s#:-]*([A-Z0-9-]{6,})/i);
  // Cap all numeric matches at 13 digits — Amazon payment numbers are 9 digits.
  // 14-15 digit numbers are Return IDs (e.g. 150001590244552) and must not be used as payment refs.
  const remittanceRef =
    parsed.paymentNumber ??
    matchOne(text, /payment[\s#:-]*(?:number|no)[\s#:-]*([0-9]{6,13})/i) ??
    (_alphaRef && (_alphaRef.match(/\d/g)?.length ?? 0) >= 3 ? _alphaRef : null) ??
    matchOne(text, /\b\d{9,13}\b/);
  const netPaid = parsed.paymentAmount ?? amountNear(text, /net\s*paid|net\s*payment/i);
  // Amazon 6-column emails don't have explicit Gross/Deductions header labels — derive from lines.
  const computedGross = parsed.lines.reduce((s, ln) => s + ((ln.amountPaid ?? 0) > 0 ? (ln.amountPaid ?? 0) : 0), 0);
  const computedDeductions = parsed.lines.reduce((s, ln) => s + ((ln.amountPaid ?? 0) < 0 ? (ln.amountPaid ?? 0) : 0), 0);
  const gross = amountNear(text, /gross/i) ?? (computedGross > 0 ? Math.round(computedGross * 100) / 100 : null);
  const deductions = amountNear(text, /deduction/i) ?? (computedDeductions < 0 ? Math.round(computedDeductions * 100) / 100 : null);

  const receivedAt = payload.receivedAt ?? new Date().toISOString();
  const operations: UpsertOperation[] = [];
  const notes: string[] = [];

  if (remittanceRef) {
    const remittanceValues: RemittanceInsert = {
      remittance_ref: remittanceRef,
      net_paid_aed: netPaid ?? null,
      gross_amount_aed: gross ?? null,
      deductions_aed: deductions ?? null,
      payment_date: parsed.paymentDate ?? (payload.receivedAt ? payload.receivedAt.slice(0, 10) : null),
      // Keep the raw body so the line parser can be diagnosed/improved without re-fetching.
      raw_body: payload.bodyText ? payload.bodyText.slice(0, 20000) : null,
    };
    operations.push({
      table: "remittances",
      naturalKey: { column: "remittance_ref", value: remittanceRef },
      action: "insert_or_update",
      values: remittanceValues,
    });
  } else {
    notes.push("No remittance reference found — remittance row not written.");
  }

  const eaValues: ExpectedActionInsert = {
    type: "remittance",
    status: "open",
    ref_number: remittanceRef ?? null,
    aed_amount: netPaid ?? null,
    email_received_at: receivedAt,
    email_subject: payload.subject ?? null,
    email_sender: payload.from ?? null,
    assigned_to: DEFAULT_ASSIGNEE_ID,
  };
  operations.push({
    table: "expected_actions",
    naturalKey: remittanceRef ? { column: "ref_number", value: remittanceRef } : null,
    action: "insert_or_update",
    values: eaValues,
  });

  // Invoice breakdown → remittance_lines (one per row); negative Amount Paid lines
  // also create a remittance_deductions task for Maricel to categorise + close.
  if (remittanceRef && parsed.lines.length > 0) {
    let negatives = 0;
    for (const ln of parsed.lines) {
      const lineKey = `${remittanceRef}:${ln.invoiceNumber}`;
      const isCoop = /co-?op/i.test(ln.description);
      operations.push({
        table: "remittance_lines",
        naturalKey: { column: "line_key", value: lineKey },
        action: "insert_or_update",
        values: {
          line_key: lineKey,
          remittance_ref: remittanceRef,
          invoice_number: ln.invoiceNumber,
          invoice_date: ln.invoiceDate,
          description: ln.description,
          vendor_code: ln.vendorCode ?? null,
          transaction_type: ln.transactionType ?? (isCoop ? "coop" : null),
          invoice_amount_aed: ln.invoiceAmount ?? null,
          terms_discount_taken_aed: ln.termsDiscountTaken ?? null,
          amount_paid_aed: ln.amountPaid,
          amount_remaining_aed: ln.amountRemaining,
          is_credit: (ln.amountPaid ?? 0) < 0,
          partial: ln.partial,
        },
      });

      // A negative Amount Paid is a deduction Amazon took back → needs explaining.
      if ((ln.amountPaid ?? 0) < 0) {
        negatives += 1;
        operations.push({
          table: "remittance_deductions",
          naturalKey: { column: "source_line_key", value: lineKey },
          action: "insert_or_update",
          values: {
            source_line_key: lineKey,
            remittance_ref: remittanceRef,
            amount_aed: ln.amountPaid,
            charge_type: isCoop ? "coop_mdf" : null,
            status: "open",
            created_by: DEFAULT_ASSIGNEE_ID,
          },
        });
      }
    }
    notes.push(
      `Remittance → ${parsed.lines.length} line(s) parsed; ${negatives} negative deduction(s) created for review.`
    );
  } else {
    notes.push("Remittance → no invoice line table found in this email (header only).");
  }

  return {
    type: "remittance",
    matched: true,
    fields: { remittanceRef, netPaid, gross, deductions },
    operations,
    notes,
  };
}
