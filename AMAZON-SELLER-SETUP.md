# Amazon Seller Central (SP-API) — database setup

Run once in the Supabase SQL editor. Stores synced Seller Central **finance
settlements** and **FBA customer returns**. Read by managers + the seller_central
grantees (Maricel, Aaron); the sync job writes via the service role.

> Env (already set in Vercel): `SELLER_SPAPI_CLIENT_ID`, `SELLER_SPAPI_CLIENT_SECRET`,
> `SELLER_SPAPI_REFRESH_TOKEN`. Marketplace defaults to UAE `A2VIGQ35RCS4UG`.

```sql
-- ── Finance: settlement / financial event groups ────────────────────────────
create table if not exists public.seller_finance_groups (
  id uuid primary key default gen_random_uuid(),
  group_id text not null unique,
  status text,
  start_time timestamptz,
  end_time timestamptz,
  fund_transfer_date timestamptz,
  currency text,
  original_total numeric,
  converted_total numeric,
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists seller_fin_start_idx on public.seller_finance_groups (start_time desc);

-- ── Orders: live order tracking / fulfillment (Orders API) ──────────────────
create table if not exists public.seller_orders (
  id uuid primary key default gen_random_uuid(),
  amazon_order_id text not null unique,
  purchase_date timestamptz,
  last_update_date timestamptz,
  order_status text,
  fulfillment_channel text,
  sales_channel text,
  ship_service_level text,
  items_shipped integer,
  items_unshipped integer,
  order_total numeric,
  currency text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists seller_ord_date_idx on public.seller_orders (purchase_date desc);
create index if not exists seller_ord_status_idx on public.seller_orders (order_status);

-- ── Return documentation (Maricel: invoice / PRT / SRT per Amazon order) ────
create table if not exists public.seller_order_docs (
  id uuid primary key default gen_random_uuid(),
  amazon_order_id text not null unique,
  invoice_number text,
  prt_number text,
  srt_number text,
  return_note text,
  doc_status text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Orders / Fulfillment: FBA customer returns ──────────────────────────────
create table if not exists public.seller_returns (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source text,
  order_id text,
  sku text,
  asin text,
  return_date timestamptz,
  quantity integer,
  reason text,
  status text,
  fulfillment_center text,
  detailed_disposition text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.seller_returns add column if not exists source text;  -- fba | mfn
create index if not exists seller_ret_date_idx on public.seller_returns (return_date desc);
create index if not exists seller_ret_order_idx on public.seller_returns (order_id);

-- ── RLS: managers/admin + Maricel + Aaron may read ──────────────────────────
alter table public.seller_finance_groups enable row level security;
alter table public.seller_orders enable row level security;
alter table public.seller_order_docs enable row level security;
alter table public.seller_returns enable row level security;

-- Orders: Aaron + Maricel + Kesh (warehouse) + managers
drop policy if exists seller_ord_read on public.seller_orders;
create policy seller_ord_read on public.seller_orders for select to authenticated
  using (public.current_user_role() in ('manager','admin','logistics')
         or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'    -- Maricel
         or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');  -- Aaron

-- Return docs: read for Kesh (logistics) + Maricel + managers; writes go via the
-- service-role route (/api/spapi/seller-order-doc), gated to Maricel + managers.
drop policy if exists seller_doc_read on public.seller_order_docs;
create policy seller_doc_read on public.seller_order_docs for select to authenticated
  using (public.current_user_role() in ('manager','admin','logistics')
         or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'    -- Maricel
         or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');  -- Aaron

drop policy if exists seller_fin_read on public.seller_finance_groups;
create policy seller_fin_read on public.seller_finance_groups for select to authenticated
  using (public.current_user_role() in ('manager','admin')
         or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'    -- Maricel
         or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');  -- Aaron

-- Returns are also surfaced in the Marketplace Returns page, so Kesh (logistics)
-- can read them too.
drop policy if exists seller_ret_read on public.seller_returns;
create policy seller_ret_read on public.seller_returns for select to authenticated
  using (public.current_user_role() in ('manager','admin','logistics')
         or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'    -- Maricel
         or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');  -- Aaron

-- last-sync marker
insert into public.app_settings (key, value) values ('seller_last_sync', null)
on conflict (key) do nothing;
```
