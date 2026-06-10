# Blockers + Manager Summary — Setup (owner-run)

Adds a **Blockers** section (any user raises their own; resolving clears it; ageing shown)
and the backing for the **Manager monthly summary** (a saved default recipient).

## 1. Blockers table + RLS (Supabase → SQL Editor)
```sql
create table if not exists public.blockers (
  id           uuid primary key default gen_random_uuid(),
  what         text not null,
  note         text,
  status       text not null default 'open',          -- open | resolved
  ageing_from  timestamptz not null default now(),    -- ageing starts here (raised date)
  created_by   uuid references public.users(id),
  resolved_at  timestamptz,
  resolved_by  uuid references public.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists blockers_status_idx on public.blockers(status);

alter table public.blockers enable row level security;

-- Read: your own, or any if you're a manager.
drop policy if exists "blockers_read" on public.blockers;
create policy "blockers_read" on public.blockers for select to authenticated
using (auth.uid() = created_by or public.current_user_role() = 'manager');

-- Insert: only as yourself.
drop policy if exists "blockers_insert" on public.blockers;
create policy "blockers_insert" on public.blockers for insert to authenticated
with check (auth.uid() = created_by);

-- Update (resolve/reopen): your own, or any if you're a manager.
drop policy if exists "blockers_update" on public.blockers;
create policy "blockers_update" on public.blockers for update to authenticated
using (auth.uid() = created_by or public.current_user_role() = 'manager')
with check (auth.uid() = created_by or public.current_user_role() = 'manager');
```

## 2. App settings table (stores the monthly-summary default recipient)
```sql
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

-- Managers can read & write settings (e.g. the monthly-summary recipient).
drop policy if exists "app_settings_rw" on public.app_settings;
create policy "app_settings_rw" on public.app_settings for all to authenticated
using (public.current_user_role() = 'manager')
with check (public.current_user_role() = 'manager');
```

After running both, the **Blockers** nav item works for everyone, and the manager
dashboard's **Send monthly summary** can save its default recipient.
