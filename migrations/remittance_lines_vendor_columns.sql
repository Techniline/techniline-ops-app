-- Add vendor_code and terms_discount_taken_aed to remittance_lines.
-- Amazon vendor remittance emails now have a 9-column table (previously 6).
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE remittance_lines
  ADD COLUMN IF NOT EXISTS vendor_code text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS terms_discount_taken_aed numeric DEFAULT NULL;
