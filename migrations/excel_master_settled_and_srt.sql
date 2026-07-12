-- One-time backfill from the Excel master file (Amazon vendor SOA 17-06-2022 (4).xlsx)
-- Green highlight = settled in the books.
-- Col M SRT values = the SRT return reference(s) for that deduction line.
--
-- Matching key: remittance_lines.line_key / remittance_deductions.source_line_key
-- are both stored as '{payment_number}:{document_number}'.
--
-- Run once in Supabase SQL editor. Safe to re-run (idempotent guards on every statement).

-- ─── SECTION 1: Mark settled lines ───────────────────────────────────────────
-- 12 non-provision lines highlighted green in the master file.

UPDATE remittance_lines
SET settled_at = NOW()
WHERE line_key IN (
  '203912620:7500143808',
  '203912620:WS2200182SC',
  '204467531:7400008239',
  '204739387:WS2200403SC',
  '208099162:7500157525',
  '208145686:7500158453',
  '209422014:7500161562',
  '223817996:WS2201143',
  '223862261:WS2201372',
  '224372039:7500192338',
  '224471948:WS2201392',
  '249654187:WS2200729SCR'
)
AND settled_at IS NULL;

-- ─── SECTION 2: Set SRT numbers on deductions ─────────────────────────────────
-- 18 rows with real SRT refs in col M (narrative-only rows 927 & 1086 skipped).

UPDATE remittance_deductions SET srt_number = 'SRT/2200079'
  WHERE source_line_key = '200378027:7500134202' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200064, 65, 73'
  WHERE source_line_key = '203912620:7500144652' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200067, 68'
  WHERE source_line_key = '203912620:7500145066' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200066'
  WHERE source_line_key = '203912620:7500147798' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200069'
  WHERE source_line_key = '204467531:7400008239' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200081, 82, 83, 84, 85, 86'
  WHERE source_line_key = '204739387:7500149216' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200087'
  WHERE source_line_key = '204739387:7500149183' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200093, 80, 78'
  WHERE source_line_key = '205442209:7500151154' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200088'
  WHERE source_line_key = '205768838:7500151741' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200077'
  WHERE source_line_key = '205768838:7500151856' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200101'
  WHERE source_line_key = '208099162:7500157525' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200103'
  WHERE source_line_key = '208145686:7500158453' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2200112, 13'
  WHERE source_line_key = '209422014:7500161562' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2300126'
  WHERE source_line_key = '255098028:7500285561' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2300171, 172, 173'
  WHERE source_line_key = '255098028:7500285204' AND srt_number IS NULL;

-- Row 1022: also has DSPT21059659103 — dispute link handled separately by backfill migration.
UPDATE remittance_deductions SET srt_number = 'SRT/2500033'
  WHERE source_line_key = '296211657:7500398263' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2500007, SRT/2500008'
  WHERE source_line_key = '324398657:7500458025' AND srt_number IS NULL;

UPDATE remittance_deductions SET srt_number = 'SRT/2400263'
  WHERE source_line_key = '324398657:7500458661' AND srt_number IS NULL;
