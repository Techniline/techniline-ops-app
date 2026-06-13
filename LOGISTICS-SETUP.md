# Logistics module — database setup

Run this SQL **once** in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
It is idempotent (`if not exists` / `on conflict`) so re-running is safe.

After running, create Kesh Rana's login (see **Step 2** at the bottom).

---

## Step 1 — Schema

```sql
-- ============================================================
-- USERS: portal access + active flag
-- ============================================================
alter table public.users add column if not exists portal_access text[] default '{}';
alter table public.users add column if not exists active boolean not null default true;

-- ============================================================
-- SHOPIFY ORDERS  (MusicMajlis channel; Shopify order id = unique key)
-- ============================================================
create table if not exists public.shopify_orders (
  id                     uuid primary key default gen_random_uuid(),
  shopify_order_id       text not null unique,          -- dedupe key
  order_number           text,                          -- e.g. #MM1042
  document_status        text,
  shopify_created_at     timestamptz,
  fulfillment_status     text,                          -- Shopify's own status
  financial_status       text,
  customer_name          text,
  order_value            numeric,
  currency               text default 'AED',
  payment_method         text,
  shipping_phone         text,
  shipping_method        text,
  shipping_city          text,
  email                  text,
  delivery_address       text,
  -- internal logistics workflow status (separate from Shopify fulfillment)
  logistics_status       text not null default 'new_order',
  tracking_number        text,
  raw                    jsonb,                         -- full Shopify payload
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists shopify_orders_logistics_status_idx on public.shopify_orders (logistics_status);
create index if not exists shopify_orders_created_idx on public.shopify_orders (shopify_created_at desc);

-- ============================================================
-- SHOPIFY ORDER ITEMS  (line items)
-- ============================================================
create table if not exists public.shopify_order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.shopify_orders(id) on delete cascade,
  shopify_line_id    text unique,                -- dedupe key; preserves internal pick/pack state on re-sync
  title              text,
  sku                text,
  brand              text,
  qty_ordered        integer default 0,
  unit_price         numeric,
  total_price        numeric,
  fulfilled_qty      integer default 0,
  source_location    text default 'warehouse',   -- warehouse|hq|al_shoala|soundline|other
  picking_status     text default 'not_checked', -- not_checked|available|requested|picked|packed|not_available|issue
  picked             boolean not null default false,
  packed             boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists shopify_order_items_order_idx on public.shopify_order_items (order_id);

-- ============================================================
-- TRACKING UPDATES  (one per dispatch attempt; keeps Shopify push history)
-- ============================================================
create table if not exists public.tracking_updates (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.shopify_orders(id) on delete cascade,
  courier            text,                       -- aramex|quiqup|jeebly|team|cargo|other
  tracking_number    text,
  tracking_url       text,
  dispatch_date      date,
  delivery_notes     text,
  pushed_to_shopify  boolean not null default false,
  shopify_error      text,                       -- last push error, if any
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now()
);
create index if not exists tracking_updates_order_idx on public.tracking_updates (order_id);

-- ============================================================
-- PRT REQUESTS  (product transfer requests, per line item)
-- ============================================================
create table if not exists public.prt_requests (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid references public.shopify_orders(id) on delete set null,
  order_number       text,
  customer_name      text,
  sku                text,
  title              text,
  brand              text,
  qty                integer default 1,
  from_location      text,
  to_location        text,
  requested_by       uuid references public.users(id),
  required_date      date,
  urgency            text default 'normal',      -- normal|urgent|same_day|customer_waiting
  status             text not null default 'requested', -- requested|approved|picking|in_transit|received|cancelled|not_available|closed
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists prt_requests_status_idx on public.prt_requests (status);

-- ============================================================
-- RESELLER DELIVERIES  (manual)
-- ============================================================
create table if not exists public.reseller_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  reseller_name      text,
  reference_no       text,
  contact_person     text,
  phone              text,
  city               text,
  delivery_address   text,
  items_summary      text,
  total_value        numeric,
  payment_method     text,
  courier            text,
  tracking_number    text,
  dispatch_date      date,
  status             text not null default 'new', -- new|preparing|ready|out_for_delivery|delivered|cancelled|issue
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists reseller_deliveries_status_idx on public.reseller_deliveries (status);

-- ============================================================
-- CARGO DELIVERIES  (manual)
-- ============================================================
create table if not exists public.cargo_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  consignee_name     text,
  reference_no       text,
  contact_person     text,
  phone              text,
  destination        text,
  delivery_address   text,
  items_summary      text,
  cartons            integer,
  weight_kg          numeric,
  dimensions         text,
  awb_number         text,
  cargo_company      text,
  dispatch_date      date,
  status             text not null default 'new', -- new|packing|waiting_pickup|picked_up|in_transit|delivered|issue|cancelled
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists cargo_deliveries_status_idx on public.cargo_deliveries (status);

-- ============================================================
-- ACTIVITY LOG  (every important logistics action)
-- ============================================================
create table if not exists public.logistics_activity_logs (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text,            -- order|prt|reseller|cargo|tracking
  entity_id     text,
  order_number  text,
  action        text,
  old_value     text,
  new_value     text,
  notes         text,
  user_id       uuid references public.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists logistics_activity_logs_created_idx on public.logistics_activity_logs (created_at desc);

-- ============================================================
-- API ERROR LOG  (Shopify sync + fulfillment failures)
-- ============================================================
create table if not exists public.logistics_api_error_logs (
  id            uuid primary key default gen_random_uuid(),
  source        text,            -- shopify_sync|shopify_fulfillment
  context       text,            -- order number / endpoint
  message       text,
  payload       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists logistics_api_error_logs_created_idx on public.logistics_api_error_logs (created_at desc);

-- ============================================================
-- SYNC STATE  (last sync timestamp lives in app_settings)
-- ============================================================
insert into public.app_settings (key, value)
values ('logistics_shopify_last_sync', null)
on conflict (key) do nothing;

-- ============================================================
-- ROW LEVEL SECURITY
-- Only logistics-capable users (logistics role, manager, admin) may read/write.
-- This blocks Aaron/Maricel from these tables at the database layer too.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'shopify_orders','shopify_order_items','tracking_updates','prt_requests',
    'reseller_deliveries','cargo_deliveries','logistics_activity_logs','logistics_api_error_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_logistics_rw', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.current_user_role() in (''manager'',''admin'',''logistics'')) with check (public.current_user_role() in (''manager'',''admin'',''logistics''))',
      t || '_logistics_rw', t
    );
  end loop;
end $$;
```

---

## Step 1b — Per-page access for Maricel & Aaron (optional grants)

Maricel (Reseller / PRT / Reports) and Aaron (Shopify orders) are `staff`, so the
RLS policies above would block them. Re-run this to let those two specific users
through at the database layer (the app still limits each to their granted pages).
Safe to re-run; uses their fixed Supabase UIDs.

```sql
do $$
declare
  t text;
  cond constant text :=
    '(public.current_user_role() in (''manager'',''admin'',''logistics'') '
    || 'or auth.uid() in (''227fdb27-80b5-4040-ab14-4bb945068af7'',''cbb81b27-8756-4f2d-bfe0-04211c27092c''))';
begin
  foreach t in array array[
    'shopify_orders','shopify_order_items','tracking_updates','prt_requests',
    'reseller_deliveries','cargo_deliveries','logistics_activity_logs','logistics_api_error_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_logistics_rw', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using %s with check %s',
      t || '_logistics_rw', t, cond, cond
    );
  end loop;
end $$;
```

---

## Step 1c — Reseller scheduled-delivery date (run once)

Adds the requested/scheduled delivery date (delay is counted from this) and the
requester reference. Idempotent.

```sql
alter table public.reseller_deliveries add column if not exists scheduled_date date;
alter table public.reseller_deliveries add column if not exists requested_by uuid references public.users(id);
```

---

## Step 1d — TLE invoice + cancellation closure + saved views (run once)

Adds per-order TLE invoice verification, SRT/PRT closure for cancelled orders,
and a generic per-user table-view preference store. Idempotent.

```sql
-- TLE invoice verification + cancellation closure on each order
alter table public.shopify_orders add column if not exists tle_invoice_number text;
alter table public.shopify_orders add column if not exists invoice_value numeric;
alter table public.shopify_orders add column if not exists invoiced_skus text;
alter table public.shopify_orders add column if not exists invoice_remarks text;
alter table public.shopify_orders add column if not exists invoice_verified boolean not null default false;
alter table public.shopify_orders add column if not exists invoice_checked_by uuid references public.users(id);
alter table public.shopify_orders add column if not exists invoice_checked_at timestamptz;
alter table public.shopify_orders add column if not exists srt_number text;
alter table public.shopify_orders add column if not exists prt_number text;
alter table public.shopify_orders add column if not exists cancellation_closed boolean not null default false;

-- Per-user saved table views (column order / hidden columns), follows the user
-- across devices. A user may only read/write their own rows.
create table if not exists public.user_prefs (
  user_id uuid not null references public.users(id) on delete cascade,
  key     text not null,
  value   jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_prefs enable row level security;
drop policy if exists user_prefs_own on public.user_prefs;
create policy user_prefs_own on public.user_prefs for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

---

## Step 1e — Reseller delivery: driver / vehicle / document fields (run once)

Adds driver, vehicle and document-reference fields used by the reseller delivery
note + invoice autofill. Idempotent.

```sql
alter table public.reseller_deliveries add column if not exists do_number text;
alter table public.reseller_deliveries add column if not exists invoice_number text;
alter table public.reseller_deliveries add column if not exists driver_name text;
alter table public.reseller_deliveries add column if not exists driver_phone text;
alter table public.reseller_deliveries add column if not exists vehicle_number text;
create index if not exists reseller_deliveries_created_idx on public.reseller_deliveries (created_at desc);
```

---

## Step 1f — Master data: customers / drivers / vehicles (run once)

Persistent master tables that auto-fill from saved deliveries. Everyone on the
logistics team can read them and add new names; only manager/admin can edit or
delete (correct details, add license/insurance expiry, deactivate, dedupe).

```sql
create table if not exists public.logistics_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_person text, phone text, city text, address text, trn text, payment_terms text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.logistics_drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text, license_no text, license_expiry date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.logistics_vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null unique,
  vehicle_type text, reg_expiry date, insurance_expiry date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: read + insert for the logistics team (manager/admin/logistics + Maricel,
-- Aaron); update/delete restricted to manager/admin.
do $$
declare
  t text;
  team constant text :=
    '(public.current_user_role() in (''manager'',''admin'',''logistics'') '
    || 'or auth.uid() in (''227fdb27-80b5-4040-ab14-4bb945068af7'',''cbb81b27-8756-4f2d-bfe0-04211c27092c''))';
  mgr constant text := '(public.current_user_role() in (''manager'',''admin''))';
begin
  foreach t in array array['logistics_customers','logistics_drivers','logistics_vehicles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using %s', t || '_read', t, team);
    execute format('create policy %I on public.%I for insert to authenticated with check %s', t || '_insert', t, team);
    execute format('create policy %I on public.%I for update to authenticated using %s with check %s', t || '_update', t, mgr, mgr);
    execute format('create policy %I on public.%I for delete to authenticated using %s', t || '_delete', t, mgr);
  end loop;
end $$;
```

---

## Step 1g — Store the invoice & DO files (run once)

Adds a private storage bucket for the PDFs + two path columns on the delivery.
The logistics team can upload/read; only manager/admin can delete.

```sql
alter table public.reseller_deliveries add column if not exists invoice_file text;
alter table public.reseller_deliveries add column if not exists do_file text;

insert into storage.buckets (id, name, public)
values ('logistics-docs', 'logistics-docs', false)
on conflict (id) do nothing;

do $$
declare
  team constant text :=
    '(bucket_id = ''logistics-docs'' and (public.current_user_role() in (''manager'',''admin'',''logistics'') '
    || 'or auth.uid() in (''227fdb27-80b5-4040-ab14-4bb945068af7'',''cbb81b27-8756-4f2d-bfe0-04211c27092c'')))';
  mgr constant text := '(bucket_id = ''logistics-docs'' and public.current_user_role() in (''manager'',''admin''))';
begin
  drop policy if exists logistics_docs_read on storage.objects;
  drop policy if exists logistics_docs_insert on storage.objects;
  drop policy if exists logistics_docs_update on storage.objects;
  drop policy if exists logistics_docs_delete on storage.objects;
  execute format('create policy logistics_docs_read on storage.objects for select to authenticated using %s', team);
  execute format('create policy logistics_docs_insert on storage.objects for insert to authenticated with check %s', team);
  execute format('create policy logistics_docs_update on storage.objects for update to authenticated using %s with check %s', team, team);
  execute format('create policy logistics_docs_delete on storage.objects for delete to authenticated using %s', mgr);
end $$;
```

---

## Step 1h — Marketplace returns (run once)

Warehouse-logged returns for Amazon Vendor / DF / Seller-Flex / Noon. Kesh logs
the receipt; Maricel completes the documentation. Team (manager/admin/logistics
+ Maricel) can read/write.

```sql
create table if not exists public.marketplace_returns (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  return_ref text, order_ref text, asin text, sku text, product text, brand text,
  qty integer default 1, reason text, carrier text, tracking_number text,
  received_date date, condition text, physical_status text not null default 'received',
  location text default 'warehouse', notes text,
  doc_status text not null default 'pending', claim_amount numeric,
  credit_note_no text, srt_number text, prt_number text, dispute_id text, case_id text,
  doc_remarks text,
  items jsonb,  -- product lines: [{sku, product, qty, condition}], up to 10
  logged_by uuid references public.users(id), documented_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.marketplace_returns add column if not exists items jsonb;
create index if not exists marketplace_returns_channel_idx on public.marketplace_returns (channel);
create index if not exists marketplace_returns_doc_idx on public.marketplace_returns (doc_status);
create index if not exists marketplace_returns_created_idx on public.marketplace_returns (created_at desc);

alter table public.marketplace_returns enable row level security;
do $$
declare cond constant text :=
  '(public.current_user_role() in (''manager'',''admin'',''logistics'') '
  || 'or auth.uid() = ''227fdb27-80b5-4040-ab14-4bb945068af7'')';  -- + Maricel (docs); not Aaron
begin
  drop policy if exists marketplace_returns_rw on public.marketplace_returns;
  execute format('create policy marketplace_returns_rw on public.marketplace_returns for all to authenticated using %s with check %s', cond, cond);
end $$;
```

---

## Step 2 — Create Kesh Rana's login

The server gates Logistics access by `users.role = 'logistics'`.

1. **Auth → Users → Add user**: email `warehouse2@techniline.org`, set a temporary
   password, tick *Auto confirm user*.
2. Copy the new user's **UID**, then run (replace `PASTE_UID`):

```sql
insert into public.users (id, email, full_name, role, active, portal_access)
values ('PASTE_UID', 'warehouse2@techniline.org', 'Kesh Rana', 'logistics', true, array['logistics'])
on conflict (id) do update
  set role = 'logistics',
      full_name = 'Kesh Rana',
      portal_access = array['logistics'],
      active = true;
```

Kesh will land on `/logistics` and is blocked (at the routing layer) from every
other portal. Managers and Admin keep full access to Logistics plus everything else.
