-- Daily Standup Logs
-- Run this in the Supabase SQL editor (one-time migration).

create table if not exists standup_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  log_date     date not null,
  yesterday_items jsonb not null default '[]'::jsonb,
  today_items     jsonb not null default '[]'::jsonb,
  blocker_items   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(user_id, log_date)
);

-- Each item shape: { id, text, detail?, status: 'done'|'carried'|'pending' }
-- 'done'    — completed on this day, appears in Yesterday
-- 'carried' — rolled from yesterday into today automatically
-- 'pending' — in-progress / default for today items

alter table standup_logs enable row level security;

-- Users can read and write only their own log
create policy "standup_own_read" on standup_logs for select
  using (auth.uid() = user_id);

create policy "standup_own_write" on standup_logs for insert
  with check (auth.uid() = user_id);

create policy "standup_own_update" on standup_logs for update
  using (auth.uid() = user_id);

-- Manager (Vihan) can read all logs
create policy "standup_manager_read" on standup_logs for select
  using (exists (select 1 from users where id = auth.uid() and role = 'manager'));

-- Index for date-range queries
create index if not exists standup_logs_date_idx on standup_logs(log_date desc);
create index if not exists standup_logs_user_date_idx on standup_logs(user_id, log_date desc);
