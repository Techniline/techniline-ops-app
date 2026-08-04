-- Marketplace Returns v2 — serial number, image attachments, audit log
-- Run in Supabase SQL editor (Settings → SQL editor).

-- 1. New columns on marketplace_returns
ALTER TABLE marketplace_returns
  ADD COLUMN IF NOT EXISTS serial_number         text,
  ADD COLUMN IF NOT EXISTS serial_number_skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_urls            text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS logged_by_name        text,
  ADD COLUMN IF NOT EXISTS documented_by_name    text;

-- 2. Audit log table
CREATE TABLE IF NOT EXISTS marketplace_returns_audit (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      uuid        NOT NULL REFERENCES marketplace_returns(id) ON DELETE CASCADE,
  action         text        NOT NULL,        -- 'created' | 'updated' | 'deleted'
  changed_by     uuid,                        -- auth.users.id
  changed_by_name text,                       -- display name / email
  changed_at     timestamptz NOT NULL DEFAULT now(),
  snapshot       jsonb                        -- full row state at time of change
);

CREATE INDEX IF NOT EXISTS idx_mr_audit_return_id
  ON marketplace_returns_audit(return_id, changed_at DESC);

ALTER TABLE marketplace_returns_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "team_read_audit"   ON marketplace_returns_audit;
DROP POLICY IF EXISTS "team_insert_audit" ON marketplace_returns_audit;
CREATE POLICY "team_read_audit"   ON marketplace_returns_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_insert_audit" ON marketplace_returns_audit FOR INSERT TO authenticated WITH CHECK (true);

-- 3. Supabase Storage bucket for return images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'return-images',
  'return-images',
  true,        -- public so img src URLs work without auth headers
  10485760,    -- 10 MB per file
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "return_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "return_images_delete" ON storage.objects;
CREATE POLICY "return_images_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'return-images');

CREATE POLICY "return_images_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'return-images');
