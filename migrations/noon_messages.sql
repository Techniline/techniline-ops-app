-- Noon buyer messages inbox
create table if not exists noon_messages (
  id uuid default gen_random_uuid() primary key,
  message_id text unique not null,
  order_nr text,
  thread_id text,
  buyer_name text,
  subject text,
  body text,
  direction text check (direction in ('inbound', 'outbound')) not null default 'inbound',
  sent_at timestamptz,
  is_read boolean not null default false,
  replied boolean not null default false,
  raw_data jsonb,
  synced_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists noon_messages_sent_at_idx on noon_messages (sent_at desc);
create index if not exists noon_messages_order_nr_idx on noon_messages (order_nr);
create index if not exists noon_messages_unread_idx on noon_messages (is_read) where not is_read;

alter table noon_messages enable row level security;
create policy "noon_messages read" on noon_messages for select to authenticated using (true);
create policy "noon_messages update" on noon_messages for update to authenticated using (true);
