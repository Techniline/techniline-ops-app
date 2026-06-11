# Analytics & Appraisal — Setup (owner-run)

Adds the manager-only **Analytics & Performance** section: business metrics + a
per-employee monthly **appraisal scorecard** (role targets, manager rating + notes,
6-month trend, quality/error log, CSV/PDF export). Three small tables, manager-only RLS.

```sql
-- Per-person targets per metric (e.g. compliance >= 95)
create table if not exists public.performance_targets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id),
  metric_key   text not null,
  target_value numeric,
  updated_by   uuid references public.users(id),
  updated_at   timestamptz not null default now(),
  unique (user_id, metric_key)
);

-- Manager's monthly rating + notes per person
create table if not exists public.performance_reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id),
  period_month date not null,            -- 1st of the month
  rating       int,                      -- 1..5
  notes        text,
  reviewed_by  uuid references public.users(id),
  updated_at   timestamptz not null default now(),
  unique (user_id, period_month)
);

-- Quality / error / rework log (so 'quality' is measurable)
create table if not exists public.quality_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id),
  occurred_on date not null default current_date,
  category    text,
  severity    text not null default 'medium',  -- low | medium | high
  description text,
  logged_by   uuid references public.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists quality_log_user_idx on public.quality_log(user_id, occurred_on);

-- Manager-only RLS for all three (appraisal data is sensitive).
alter table public.performance_targets enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.quality_log         enable row level security;

drop policy if exists "perf_targets_rw" on public.performance_targets;
create policy "perf_targets_rw" on public.performance_targets for all to authenticated
using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

drop policy if exists "perf_reviews_rw" on public.performance_reviews;
create policy "perf_reviews_rw" on public.performance_reviews for all to authenticated
using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

drop policy if exists "quality_log_rw" on public.quality_log;
create policy "quality_log_rw" on public.quality_log for all to authenticated
using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');
```

After running, reload as the manager → an **Analytics** item appears in the sidebar.
The Appraisal tab reads each person's data live (checklist compliance/breaches,
remittance recovery, returns, cart recovery, deals, blockers); managers set targets,
rate, log quality, and export the appraisal as PDF/CSV.
