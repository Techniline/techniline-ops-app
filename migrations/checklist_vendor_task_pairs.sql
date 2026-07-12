-- Change "Amazon Vendor/DF invoices uploaded" checklist task from count→pairs
-- so Maricel enters (PO number or Order number, WS/invoice) pairs the same way
-- the seller task works. Safe to re-run (idempotent WHERE guard).

UPDATE task_definitions
SET
  evidence_type = 'pairs',
  evidence_hint = 'Enter each PO or Order number with its WS/ invoice number — syncs automatically across all modules'
WHERE title ILIKE '%Vendor%' AND title ILIKE '%invoice%' AND evidence_type = 'count';
