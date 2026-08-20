# Packing List — Setup (run once in Supabase → SQL Editor)

## 1. Tables

```sql
-- ============ SKU catalog (master physical data per model) ============
create table if not exists public.packing_sku_catalog (
  id                uuid primary key default gen_random_uuid(),
  model_no          text not null,
  brand             text,
  description       text,
  hs_code           text,
  country_of_origin text not null default 'China',
  unit_weight_kg    numeric,
  unit_cbm          numeric,
  carton_qty        integer,        -- units per master carton
  carton_weight_kg  numeric,
  carton_cbm        numeric,
  notes             text,
  source            text not null default 'manual',  -- 'import' | 'manual'
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint packing_sku_catalog_model_no_unique unique (model_no)
);

create index if not exists packing_sku_catalog_brand_idx on public.packing_sku_catalog(brand);
create index if not exists packing_sku_catalog_model_idx on public.packing_sku_catalog(model_no);

-- ============ Packing list headers ============
create table if not exists public.packing_lists (
  id                uuid primary key default gen_random_uuid(),
  company           text not null check (company in ('techniline', 'soundline')),
  mode              text not null default 'physical' check (mode in ('physical', 'invoice')),
  invoice_no        text,
  list_date         date not null default current_date,
  consignee_name    text,
  consignee_address text,
  notes             text,
  status            text not null default 'draft' check (status in ('draft', 'final')),
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============ Packing list line items ============
create table if not exists public.packing_list_items (
  id                uuid primary key default gen_random_uuid(),
  packing_list_id   uuid not null references public.packing_lists(id) on delete cascade,
  sl_no             integer not null,
  model_no          text not null,
  brand             text,
  description       text,
  hs_code           text,
  country_of_origin text,
  qty               numeric not null default 1,
  no_of_ctns        numeric,
  tot_cbm           numeric,
  total_weight_kg   numeric,
  unit_price        numeric,        -- invoice mode only
  amount            numeric,        -- qty × unit_price
  created_at        timestamptz not null default now()
);

create index if not exists packing_list_items_list_idx on public.packing_list_items(packing_list_id);
```

## 2. RLS (all authenticated users)

```sql
alter table public.packing_sku_catalog enable row level security;
alter table public.packing_lists       enable row level security;
alter table public.packing_list_items  enable row level security;

-- SKU catalog: all authenticated users can read + write
drop policy if exists "packing_sku_catalog_all" on public.packing_sku_catalog;
create policy "packing_sku_catalog_all" on public.packing_sku_catalog
  for all to authenticated
  using (true) with check (true);

-- Packing lists: all authenticated users
drop policy if exists "packing_lists_all" on public.packing_lists;
create policy "packing_lists_all" on public.packing_lists
  for all to authenticated
  using (true) with check (true);

-- Packing list items: all authenticated users
drop policy if exists "packing_list_items_all" on public.packing_list_items;
create policy "packing_list_items_all" on public.packing_list_items
  for all to authenticated
  using (true) with check (true);
```

## 2b. Migration — add box_no column (run if tables already exist)

```sql
ALTER TABLE public.packing_list_items ADD COLUMN IF NOT EXISTS box_no integer;
```

## 2c. Migration — add shipping_label column (run if tables already exist)

```sql
ALTER TABLE public.packing_lists ADD COLUMN IF NOT EXISTS shipping_label text;
```

## 3. After running

- Go to `/packing-list/catalog` in the app to verify the catalog loaded
- Use the "Import from Excel" button on the catalog page to bulk-import SKUs from the brand volume charts
- Or run the import script: `python scripts/import-packing-skus.py`
