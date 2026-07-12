-- Accounts team: per-line settlement tracking on remittance lines.
-- Run once in Supabase SQL editor.

ALTER TABLE remittance_lines
  ADD COLUMN IF NOT EXISTS settled_at timestamptz DEFAULT NULL;
