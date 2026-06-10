# Music Majlis Sales Tracker — Setup (owner-run)

Adds a **MUSICMAJLIS** sales band to the Dashboard (visible to Aaron + managers):
monthly target (manager-set), achieved net sales + abandoned carts (from Shopify),
% achieved, a daily target that recalculates from progress, and a Shopify-validated
**recovered-cart log**. Run the SQL, then set the Shopify env vars.

## 1. Tables + RLS (Supabase → SQL Editor)
```sql
-- Monthly target (one row per month)
create table if not exists public.mm_targets (
  id            uuid primary key default gen_random_uuid(),
  month         date not null unique,        -- 1st of the month
  target_amount numeric not null,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now()
);
alter table public.mm_targets enable row level security;
drop policy if exists "mm_targets_read" on public.mm_targets;
create policy "mm_targets_read" on public.mm_targets for select to authenticated
using (public.current_user_role() = 'manager' or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');
drop policy if exists "mm_targets_write" on public.mm_targets;
create policy "mm_targets_write" on public.mm_targets for all to authenticated
using (public.current_user_role() = 'manager')
with check (public.current_user_role() = 'manager');

-- Recovered abandoned carts (Shopify-validated)
create table if not exists public.mm_recovered_carts (
  id                 uuid primary key default gen_random_uuid(),
  recovered_date     date not null default current_date,
  order_ref          text not null,
  amount             numeric,
  validation_status  text not null default 'pending_validation',  -- valid | invalid | api_error | pending_validation
  validation_message text,
  note               text,
  recovered_by       uuid references public.users(id),
  created_at         timestamptz not null default now()
);
create index if not exists mm_recovered_date_idx on public.mm_recovered_carts(recovered_date);
alter table public.mm_recovered_carts enable row level security;
drop policy if exists "mm_recovered_rw" on public.mm_recovered_carts;
create policy "mm_recovered_rw" on public.mm_recovered_carts for all to authenticated
using (public.current_user_role() = 'manager' or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c')
with check (public.current_user_role() = 'manager' or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');
```
(`cbb81b27-…` = Aaron. Recovered-cart writes go through the server route with the
service-role key, but the read policy lets Aaron/managers see the list.)

### 1b. Abandoned-cart actioning (run this to enable the daily review + Zoho deal flow)
```sql
-- One row per Shopify abandoned checkout Aaron has actioned.
create table if not exists public.mm_abandoned_actions (
  id                  uuid primary key default gen_random_uuid(),
  checkout_id         text not null unique,        -- Shopify checkout id
  checkout_created_at timestamptz,
  customer_name       text,
  customer_email      text,
  total               numeric,
  recovery_url        text,
  action_status       text not null default 'open', -- open | actioned | deal_created | dismissed
  zoho_deal_id        text,
  note                text,
  actioned_by         uuid references public.users(id),
  actioned_at         timestamptz,
  created_at          timestamptz not null default now()
);
alter table public.mm_abandoned_actions enable row level security;
drop policy if exists "mm_abandoned_rw" on public.mm_abandoned_actions;
create policy "mm_abandoned_rw" on public.mm_abandoned_actions for all to authenticated
using (public.current_user_role() = 'manager' or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c')
with check (public.current_user_role() = 'manager' or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');
```

### 1c. Zoho deal-creation env (Vercel → Production, server-only)
Creating a Back-to-Back deal needs the Zoho refresh token re-issued with **write** scope.
Re-generate `ZOHO_REFRESH_TOKEN` with scopes:
`ZohoCRM.modules.deals.ALL,ZohoCRM.modules.contacts.READ,ZohoCRM.settings.ALL`
(the existing read-only token only validated deals). Then set:

| Variable | Value |
|---|---|
| `ZOHO_MM_PIPELINE` | `Back-to-Back Orders` (confirmed exact name from the Deals Pipeline field) |
| `ZOHO_MM_STAGE` | `New Inquiry` (first stage for a new deal) |
| `ZOHO_ORG_ID` | `712284897` (used to build deal links; already the known org) |

> Set & verified 2026-06-10: token re-issued with `deals.ALL, contacts.READ, settings.ALL`;
> refresh round-trip OK. (A dedicated `MusicMajlis` pipeline also exists in CRM if you ever
> prefer cart deals to land there instead — just change `ZOHO_MM_PIPELINE`.)

Until the write scope is in place, the **Create Zoho deal** button returns a clear error
and nothing else breaks (actioning/clearing carts still works).

### 1d. Aaron's daily abandoned-cart review task (checklist)
Adds a daily one-tap task reminding Aaron to clear yesterday's abandoned carts on the
dashboard MUSICMAJLIS band. (Cadence-aware engine skips Sundays already.)
```sql
insert into public.task_definitions
  (title, evidence_hint, evidence_type, cadence, category, sort_order, assigned_to, is_active)
values
  ('Action Music Majlis abandoned carts',
   'Open the dashboard MUSICMAJLIS band → review yesterday''s abandoned carts; for each, create a Back-to-Back Zoho deal or mark it actioned. Monday covers Sat+Sun.',
   'one_tap', 'daily', 'Music Majlis', 5,
   'cbb81b27-8756-4f2d-bfe0-04211c27092c', true)
on conflict do nothing;
```
(Adjust column names if your `task_definitions` differs — `assigned_to` scopes it to Aaron;
omit it to give the task to everyone.)

## 2. Shopify Admin API credentials (Vercel → Production env, server-only)
Create a **custom app** in the Music Majlis Shopify admin with **Admin API** scopes
`read_orders` + `read_checkouts`, install it, copy the **Admin API access token**, then set:

| Variable | Value |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | e.g. `musicmajlis.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | the Admin API access token (mark **Sensitive**) |
| `SHOPIFY_API_VERSION` | `2024-10` (optional; defaults to this) |

Until these are set, the band shows **“Shopify not connected”** and net sales / abandoned
carts read “—”, but the target and recovered-cart logging still work (recovered entries
log as `pending_validation` and can be re-logged once Shopify is connected).

## 3. After setup
- Reload **/dashboard** as Aaron or a manager → the green **MUSICMAJLIS** band appears.
- Manager: **Set MM target** → enter this month's target.
- Aaron: **Log recovered cart** → enter the recovered order #, validated against Shopify.
- Tiles: Monthly Target · Achieved (net sales) · % Achieved · Today's Target (recalculated daily) · Abandoned Carts · Recovered (this month).
