-- Remove remittance rows whose ref looks like an English word (no digits)
-- and all child rows that reference them.
-- These are produced by an overly-greedy regex fallback that has since been fixed.

DO $$
DECLARE
  bad_refs text[] := ARRAY(
    SELECT remittance_ref
    FROM remittances
    WHERE remittance_ref !~ '\d'   -- no digit at all → plain English word
  );
BEGIN
  IF array_length(bad_refs, 1) IS NULL THEN
    RAISE NOTICE 'No bad refs found, nothing to clean up.';
    RETURN;
  END IF;

  RAISE NOTICE 'Cleaning up bad refs: %', bad_refs;

  DELETE FROM remittance_deductions WHERE remittance_ref = ANY(bad_refs);
  DELETE FROM remittance_lines      WHERE remittance_ref = ANY(bad_refs);
  DELETE FROM expected_actions      WHERE ref_number     = ANY(bad_refs);
  DELETE FROM remittances           WHERE remittance_ref = ANY(bad_refs);

  RAISE NOTICE 'Done.';
END $$;
