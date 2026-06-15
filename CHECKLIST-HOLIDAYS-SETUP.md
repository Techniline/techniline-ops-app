# Checklist — company holidays (owner-run SQL)

Lets managers mark a date as a company holiday so **no checklist is generated for
anyone** that day (just like Sundays) — no missed-work breaches. Run once in
**Supabase → SQL editor**.

```sql
-- 1. Holidays table
create table if not exists public.company_holidays (
  holiday_date date primary key,
  label text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.company_holidays enable row level security;

-- Everyone signed in can read (the app shows a holiday banner / list).
drop policy if exists company_holidays_read on public.company_holidays;
create policy company_holidays_read on public.company_holidays for select to authenticated using (true);
-- Writes go only through the manager-only service-role route
-- (/api/checklist/holiday), so no client write policy is needed.

-- 2. Generator: also skip company holidays (in addition to Sundays + leave)
CREATE OR REPLACE FUNCTION public.generate_daily_tasks()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO daily_tasks (task_def_id, assigned_to, task_date, status, source, source_ref_id)
  SELECT td.id, td.assigned_to, CURRENT_DATE, 'open', 'standing', NULL
  FROM task_definitions td
  WHERE td.is_active = true
    AND td.is_email_triggered = false
    AND td.assigned_to IS NOT NULL
    AND EXTRACT(dow FROM CURRENT_DATE) <> 0                       -- skip Sunday
    AND NOT EXISTS (                                             -- skip company holidays
      SELECT 1 FROM company_holidays h WHERE h.holiday_date = CURRENT_DATE
    )
    AND (
      td.cadence = 'daily'
      OR (td.cadence = 'weekly' AND td.weekday = EXTRACT(dow FROM CURRENT_DATE)::int)
    )
    AND NOT EXISTS (
      SELECT 1 FROM staff_leave l
      WHERE l.user_id = td.assigned_to
        AND CURRENT_DATE BETWEEN l.from_date AND l.to_date       -- skip people on leave
    )
  ON CONFLICT (task_def_id, assigned_to, task_date) DO NOTHING;
$function$;
```

After this, marking a date a holiday in the app (Checklist → Holidays, managers
only) stops generation for that day and clears any already-generated open tasks.
