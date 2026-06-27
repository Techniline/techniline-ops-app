-- ── Break tracking for Aaron's chat SLA ──────────────────────────────────────
-- Run this in the Supabase SQL editor.

create table if not exists user_breaks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  type             text not null check (type in ('short', 'lunch')),
  started_at       timestamptz not null default now(),
  expected_end_at  timestamptz not null,
  ended_at         timestamptz,          -- null = still active / auto-expired
  ended_by         text check (ended_by in ('manual', 'auto'))
);

alter table user_breaks enable row level security;

-- User can manage their own breaks
create policy "user_breaks_own"
  on user_breaks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Managers can read all breaks (for dashboard status + scorecard report)
create policy "user_breaks_manager_read"
  on user_breaks for select
  using (
    exists (
      select 1 from users
      where id = auth.uid() and role = 'manager'
    )
  );

-- Index for fast status lookups
create index if not exists user_breaks_user_active_idx
  on user_breaks (user_id, started_at desc)
  where ended_at is null;
