-- Consult Bookings — Sales consult request queue with SLA tracking
-- Run once in Supabase SQL editor (service role or postgres).

CREATE TABLE IF NOT EXISTS consult_bookings (
  id             uuid            DEFAULT gen_random_uuid() PRIMARY KEY,
  name           text            NOT NULL,
  phone          text            NOT NULL,
  email          text,
  preferred_slot text,           -- 'morning' | 'afternoon' | 'late_afternoon' | null
  notes          text,
  status         text            NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'called', 'no_answer', 'closed')),
  sla_deadline   timestamptz     NOT NULL,
  created_at     timestamptz     NOT NULL DEFAULT now(),
  updated_at     timestamptz     NOT NULL DEFAULT now(),
  updated_by     uuid            REFERENCES auth.users(id),
  call_notes     text
);

-- Index for the management dashboard (most common query: open bookings by deadline)
CREATE INDEX IF NOT EXISTS consult_bookings_status_deadline_idx
  ON consult_bookings (status, sla_deadline ASC);

-- RLS: enable but allow service-role to bypass (API routes use service-role key).
ALTER TABLE consult_bookings ENABLE ROW LEVEL SECURITY;

-- No direct anon/authenticated client access — all reads/writes go through API
-- routes that authenticate and then use the service-role client.
-- If you ever need direct Supabase client access from the dashboard, add a
-- SELECT policy for the manager role here.
