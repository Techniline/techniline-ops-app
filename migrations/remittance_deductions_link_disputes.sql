-- Backfill: link existing remittance_deductions rows to the disputes table
-- by matching amazon_case_id (DSPT number) to disputes.dispute_number.
-- This is a one-time migration; future linkage is handled automatically by
-- the ingest pipeline (upsert.ts → linkDisputeToDeduction).

UPDATE remittance_deductions rd
SET
  dispute_id        = d.id,
  claim_amount_aed  = COALESCE(rd.claim_amount_aed,  d.invoice_amount_aed),
  approved_amount_aed = COALESCE(rd.approved_amount_aed, d.approved_amount_aed),
  dispute_status    = COALESCE(rd.dispute_status,    d.dispute_status)
FROM disputes d
WHERE rd.amazon_case_id = d.dispute_number
  AND rd.dispute_id IS NULL;
