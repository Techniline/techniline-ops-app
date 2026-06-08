# Checklist+ / Priorities — RLS Setup

_The checklist improvements (Work Log, Priorities, breach KPI) read/write tables the backend team already created (`priorities`, `submissions`, `breach_log`, `users`). The app needs **read/write access** to them. Run the SQL below in **Supabase → SQL Editor**. Until then the new sections show empty / actions are rejected (fail-soft — nothing breaks)._

> Policies use `auth.uid()` (the signed-in user) and `public.current_user_role()` (the existing helper that returns the user's role) for the manager override — matching the app's "own-or-manager" model. They're idempotent (drop-then-create).

## 0. Add the two missing priority columns (run first)
```sql
alter table public.priorities
  add column if not exists priority_level text,   -- 'P1' | 'P2' | 'P3'
  add column if not exists notes          text;   -- general progress notes
```
The app writes `status` ∈ `{open, in_progress, completed}` (overdue is derived). If `priorities.status` has a CHECK constraint that excludes these, relax it or send me the allowed values.

```sql
-- ============ priorities ============
alter table public.priorities enable row level security;

drop policy if exists "priorities_read"   on public.priorities;
drop policy if exists "priorities_insert" on public.priorities;
drop policy if exists "priorities_update" on public.priorities;

-- Read: managers see all; everyone else sees own / assigned / assigned-to-both.
create policy "priorities_read" on public.priorities for select to authenticated
using (
  public.current_user_role() = 'manager'
  or created_by = auth.uid()
  or assigned_to = auth.uid()
  or assigned_to_both is true
);

-- Insert: you must be the creator; managers may assign to anyone/both,
-- non-managers may only assign to themselves.
create policy "priorities_insert" on public.priorities for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    public.current_user_role() = 'manager'
    or (assigned_to = auth.uid() and coalesce(assigned_to_both, false) = false)
  )
);

-- Update: managers, the creator, or an assignee (to log progress / complete).
create policy "priorities_update" on public.priorities for update to authenticated
using (
  public.current_user_role() = 'manager'
  or created_by = auth.uid()
  or assigned_to = auth.uid()
  or assigned_to_both is true
);

-- ============ submissions (Work Log read) ============
-- Writes already work today; this adds READ for the log view.
alter table public.submissions enable row level security;
drop policy if exists "submissions_read" on public.submissions;
create policy "submissions_read" on public.submissions for select to authenticated
using (
  public.current_user_role() = 'manager'
  or submitted_by = auth.uid()
);
-- (Keep whatever INSERT policy already exists; do not drop it.)

-- ============ breach_log (KPI read) ============
alter table public.breach_log enable row level security;
drop policy if exists "breach_log_read" on public.breach_log;
create policy "breach_log_read" on public.breach_log for select to authenticated
using (
  public.current_user_role() = 'manager'
  or user_id = auth.uid()
);

-- ============ users (names for assignment + work log) ============
-- Allow authenticated users to read the (non-sensitive) user list.
alter table public.users enable row level security;
drop policy if exists "users_read_all" on public.users;
create policy "users_read_all" on public.users for select to authenticated
using (true);
```

**If `current_user_role()` doesn't exist or behaves differently**, tell me its definition (or the existing pattern your other tables use for the manager check) and I'll adjust — the rest of the policies are standard own-row checks.

**Heads-up — `priorities.status`:** the app does **not** write the `status` column (it leaves the DB default and tracks completion via `completed_at`/`progress_pct`) to avoid clashing with any CHECK constraint you've defined. If you'd like the app to set `status` too, send me the allowed values.

After running this, reload `/checklist` (Work Log + breach KPI) and `/priorities` (the module).

## Email notifications (Microsoft Graph)
Assignment emails + the weekly summary send via the existing Azure app (`/api/priorities/notify`, manager-only). To enable:
1. **Azure Portal → App registrations → "Techniline Ops Amazon Ingest"** → API permissions → add **Microsoft Graph → Application → `Mail.Send`** → **Grant admin consent**.
2. The sender mailbox defaults to `vihan@techniline.org`. To use another (e.g. a no-reply), set **`PRIORITY_MAIL_FROM`** in Vercel (Production) → redeploy.

Until `Mail.Send` is consented, **priorities still save** and a warning ("email notification failed") is shown — the data is never lost (fail-soft, as specified).

