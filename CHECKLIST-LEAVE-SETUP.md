# Checklist — Working days, cadence & leave (owner-run SQL)

_Makes the daily-task generator respect the **Mon–Sat work week** (no Sunday), the
**cadence** of each definition (daily / weekly-on-a-weekday / adhoc), and **staff leave**
(no tasks generate for someone who's away, so absences aren't counted as missed)._

Run in **Supabase → SQL Editor**, in order. (Assumes the checklist `cadence`/`weekday`
columns from the daily-checklist setup are already added — Part A there.)

## 1. Leave register table + RLS
```sql
create table if not exists public.staff_leave (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id),
  from_date  date not null,
  to_date    date not null,
  reason     text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists staff_leave_user_idx on public.staff_leave(user_id, from_date, to_date);

alter table public.staff_leave enable row level security;

drop policy if exists "staff_leave_select" on public.staff_leave;
create policy "staff_leave_select" on public.staff_leave for select to authenticated
using (public.current_user_role() = 'manager' or user_id = auth.uid());

drop policy if exists "staff_leave_insert" on public.staff_leave;
create policy "staff_leave_insert" on public.staff_leave for insert to authenticated
with check (
  public.current_user_role() = 'manager'
  or (user_id = auth.uid() and created_by = auth.uid())
);

drop policy if exists "staff_leave_delete" on public.staff_leave;
create policy "staff_leave_delete" on public.staff_leave for delete to authenticated
using (public.current_user_role() = 'manager' or user_id = auth.uid());
```

## 2. Final `generate_daily_tasks` — work-week + cadence + leave
Replaces the earlier version. Generates a task only when: not Sunday, the definition is
due today (daily, or weekly on its weekday), and the assignee is **not on leave** that day.

```sql
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
    AND EXTRACT(dow FROM CURRENT_DATE) <> 0                       -- skip Sunday (closed)
    AND (
      td.cadence = 'daily'
      OR (td.cadence = 'weekly' AND td.weekday = EXTRACT(dow FROM CURRENT_DATE)::int)
    )
    AND NOT EXISTS (
      SELECT 1 FROM staff_leave l
      WHERE l.user_id = td.assigned_to
        AND CURRENT_DATE BETWEEN l.from_date AND l.to_date       -- not on leave today
    )
  ON CONFLICT (task_def_id, assigned_to, task_date) DO NOTHING;
$function$;
```

## Notes
- **Saturday** still generates (you work till 2pm); weekly items are scheduled on weekdays,
  not Saturday, so Saturday stays light.
- **Unplanned absence:** a manager (or the person) can add the leave range after the fact —
  future generation stops; already-generated open tasks for that day can be left or cleared.
- The app's **Leave / absence** button (Checklist page) reads/writes this table; staff manage
  their own, managers manage anyone's.
- Breach reporting is driven off generated tasks, so "no tasks generated" on leave/Sunday means
  nothing to breach — the KPI stays honest going forward.
