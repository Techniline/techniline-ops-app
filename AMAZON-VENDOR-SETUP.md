# Amazon Vendor (SP-API) — database setup

Run once in the Supabase SQL editor. Stores synced Vendor Purchase Orders.
Read by managers + Maricel; the sync job writes via the service role.

```sql
create table if not exists public.vendor_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  po_state text,
  po_type text,
  po_date timestamptz,
  state_changed_at timestamptz,
  selling_party text,
  ship_to_party text,
  item_count integer default 0,
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendor_po_state_idx on public.vendor_purchase_orders (po_state);
create index if not exists vendor_po_date_idx on public.vendor_purchase_orders (po_date desc);

alter table public.vendor_purchase_orders enable row level security;
drop policy if exists vendor_po_read on public.vendor_purchase_orders;
create policy vendor_po_read on public.vendor_purchase_orders for select to authenticated
  using (public.current_user_role() in ('manager','admin')
         or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7');  -- + Maricel

-- last-sync marker
insert into public.app_settings (key, value) values ('vendor_po_last_sync', null)
on conflict (key) do nothing;
```
