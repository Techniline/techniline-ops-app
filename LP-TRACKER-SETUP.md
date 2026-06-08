# LP Tracker — Setup (owner-run)

_The LP Tracker module (`/lp`) tracks **local purchases (LPOs)** — capture from PDF, age the
remaining stock, record sales (with invoice / entity / salesman), flag price changes, and email/
export a stock-in-hand report. It needs **three new tables, one view, RLS, and a storage bucket**.
Run the SQL in **Supabase → SQL Editor**; create the bucket in **Supabase → Storage**. Nothing
existing is touched. Until this is run, `/lp` loads but shows empty / actions are rejected
(fail-soft)._

**Access:** Maricel + managers only. Maricel already has the `lp_tracker` capability in the app
(`src/lib/permissions/capabilities.ts`); the RLS below scopes DB access to her uid + any manager.

---

## 1. Tables

```sql
-- ============ lp_orders (LP header — one per LPO) ============
create table if not exists public.lp_orders (
  id                uuid primary key default gen_random_uuid(),
  lp_number         text not null unique,
  lp_date           date not null,
  vendor_name       text not null,
  vendor_trn        text,
  consignee_trn     text,
  qtn_ref           text,
  amount_before_vat numeric,
  vat_amount        numeric,
  net_amount        numeric,
  terms             text,
  pdf_url           text,
  source            text not null default 'pdf_upload',  -- 'pdf_upload' | 'manual'
  notes             text,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============ lp_items (line items — one per SKU per LP) ============
create table if not exists public.lp_items (
  id                 uuid primary key default gen_random_uuid(),
  lp_id              uuid not null references public.lp_orders(id) on delete cascade,
  line_number        int,
  brand              text,
  model_no           text,
  sku                text,
  description        text,
  qty_purchased      numeric not null default 0,
  qty_original       numeric,            -- parsed value before any manual correction
  qty_adjust_comment text,               -- required (by the app) when qty changed
  unit_price         numeric,
  amount             numeric,
  disc_amount        numeric default 0,
  status             text not null default 'open',  -- 'open' | 'cleared'
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists lp_items_lp_id_idx on public.lp_items(lp_id);
create index if not exists lp_items_sku_idx   on public.lp_items(sku);

-- ============ lp_sales (draw-down — one row per sale entry) ============
create table if not exists public.lp_sales (
  id            uuid primary key default gen_random_uuid(),
  lp_item_id    uuid not null references public.lp_items(id) on delete cascade,
  sold_qty      numeric not null,
  invoice_number text,
  entity        text,                    -- 'Al Shoala'|'SLM'|'HQ'|'MM'|'CNL'|'Other'
  entity_other  text,                    -- free text when entity = 'Other'
  salesman_name text,
  sale_date     date,
  notes         text,
  recorded_by   uuid references public.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists lp_sales_item_idx on public.lp_sales(lp_item_id);
```

## 2. View — `lp_items_view` (computed remaining + ageing)

```sql
create or replace view public.lp_items_view as
select
  i.id,
  i.lp_id,
  o.lp_number,
  o.lp_date,
  o.vendor_name,
  o.vendor_trn,
  o.pdf_url,
  i.line_number,
  i.brand,
  i.model_no,
  i.sku,
  i.description,
  i.qty_purchased,
  coalesce(s.sold, 0)                              as qty_sold,
  i.qty_purchased - coalesce(s.sold, 0)            as qty_remaining,
  i.unit_price,
  i.amount,
  i.disc_amount,
  i.qty_adjust_comment,
  i.status,
  (current_date - o.lp_date)                       as ageing_days,
  case
    when (current_date - o.lp_date) <= 30 then 'safe'
    when (current_date - o.lp_date) <= 60 then 'monitor'
    when (current_date - o.lp_date) <= 90 then 'warning'
    else 'action_required'
  end                                              as ageing_status,
  i.created_at
from public.lp_items i
join public.lp_orders o on o.id = i.lp_id
left join (
  select lp_item_id, sum(sold_qty) as sold
  from public.lp_sales
  group by lp_item_id
) s on s.lp_item_id = i.id;
```

## 3. RLS (managers + Maricel)

```sql
-- Maricel's uid; add more uids to the IN (...) lists if access widens later.
-- 227fdb27-80b5-4040-ab14-4bb945068af7 = Maricel

alter table public.lp_orders enable row level security;
alter table public.lp_items  enable row level security;
alter table public.lp_sales  enable row level security;

-- lp_orders
drop policy if exists "lp_orders_rw" on public.lp_orders;
create policy "lp_orders_rw" on public.lp_orders for all to authenticated
using (
  public.current_user_role() = 'manager'
  or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'
)
with check (
  public.current_user_role() = 'manager'
  or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'
);

-- lp_items
drop policy if exists "lp_items_rw" on public.lp_items;
create policy "lp_items_rw" on public.lp_items for all to authenticated
using (
  public.current_user_role() = 'manager'
  or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'
)
with check (
  public.current_user_role() = 'manager'
  or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'
);

-- lp_sales
drop policy if exists "lp_sales_rw" on public.lp_sales;
create policy "lp_sales_rw" on public.lp_sales for all to authenticated
using (
  public.current_user_role() = 'manager'
  or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'
)
with check (
  public.current_user_role() = 'manager'
  or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'
);
```

> The view inherits the base-table RLS (it runs as the querying user). `current_user_role()` is the
> existing helper used by the priorities/checklist policies — if it doesn't behave as expected,
> tell me and I'll adjust.

## 4. Storage bucket (Supabase → Storage)

Create a **private** bucket named **`lp-invoices`** (mirrors `cocoblu-invoices`), then add
authenticated insert/select policies:

```sql
-- Storage RLS (run in SQL Editor after creating the 'lp-invoices' bucket)
drop policy if exists "lp_invoices_insert" on storage.objects;
create policy "lp_invoices_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'lp-invoices');

drop policy if exists "lp_invoices_select" on storage.objects;
create policy "lp_invoices_select" on storage.objects for select to authenticated
using (bucket_id = 'lp-invoices');
```

(The app reads PDFs via short-lived signed URLs; objects are never public.)

## 5. After running

- Reload `/lp` (and the Dashboard) — the module, KPI tiles and card go live.
- Optional: set `ANTHROPIC_API_KEY` in Vercel to upgrade capture from the free parser to AI
  (same as Cocoblu). The free parser already reads the Techniline LPO layout (validated on
  `LPO/2600074` — header + 12/12 lines).
- Optional later: re-run `supabase gen types` for an authoritative regen (the new tables/view were
  hand-synced into `src/lib/database.types.ts` to match this schema).
