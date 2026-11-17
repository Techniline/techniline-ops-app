-- Saved Teams channels for standup sharing.
-- Run in Supabase SQL editor after RUN-STANDUP-SQL.sql.

create table if not exists standup_channels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,         -- Display name, e.g. "Techniline > Daily Scrum"
  team_id     text not null,
  channel_id  text not null,
  created_at  timestamptz not null default now(),
  unique(team_id, channel_id)
);

alter table standup_channels enable row level security;

-- Only managers can read/write saved channels
create policy "standup_channels_manager" on standup_channels
  using (exists (select 1 from users where id = auth.uid() and role = 'manager'));

create policy "standup_channels_manager_insert" on standup_channels for insert
  with check (exists (select 1 from users where id = auth.uid() and role = 'manager'));

create policy "standup_channels_manager_delete" on standup_channels for delete
  using (exists (select 1 from users where id = auth.uid() and role = 'manager'));
