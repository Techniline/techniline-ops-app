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
