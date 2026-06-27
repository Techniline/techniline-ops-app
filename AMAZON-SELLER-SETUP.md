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

-- ── Return-doc edit log (audit trail of who changed what, with a comment) ───
create table if not exists public.seller_order_doc_log (
  id uuid primary key default gen_random_uuid(),
  amazon_order_id text not null,
  changed_by uuid,
  comment text,
  invoice_number text,
  prt_number text,
  srt_number text,
  doc_status text,
  return_note text,
  created_at timestamptz not null default now()
);
create index if not exists seller_doc_log_order_idx on public.seller_order_doc_log (amazon_order_id, created_at desc);

-- ── Return documentation (invoice / PRT / SRT per Amazon order) ─────────────
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

-- ── Returns: NOT synced (kept only for history / possible future use) ───────
-- The seller returns sync was removed (the MFN returns report needs the Direct
-- to Consumer Shipping role, which Amazon declined). Returns are logged manually
-- in Marketplace Returns. This table is harmless to keep or to drop.
-- ── (legacy) FBA / MFN returns table ────────────────────────────────────────
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
alter table public.seller_order_doc_log enable row level security;
alter table public.seller_returns enable row level security;

-- Doc edit log: readable by the same people who manage docs (Kesh/Maricel/mgrs)
drop policy if exists seller_doc_log_read on public.seller_order_doc_log;
create policy seller_doc_log_read on public.seller_order_doc_log for select to authenticated
  using (public.current_user_role() in ('manager','admin','logistics')
         or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'    -- Maricel
         or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');  -- Aaron

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

---

## Profit & Pricing module (Phase 1 + 2 — LIVE, Jun 2026)

Module: **`/logistics/amazon-pricing`** (LogisticsPage `amazon_profit`; manager + Maricel view, manager-only edits). Two views: **Orders (profit)** and **Repricing (per SKU)**.

### Roles (Seller app "Techniline Ops - Seller Integration", approved Jun 2026)
Finance and Accounting · Buyer Communication · **Pricing** · Inventory and Order Tracking · Amazon Fulfillment · **Product Listing**. The refresh token **must be minted on `sellercentral.amazon.ae` (UAE)** — a US-portal token 403s on Pricing/Orders/Finances even though the roles are granted. Verify via `/amazon-actions/seller` → Discover access: `getPricing` + `getItemOffers` (Buy Box) + Product Type Definitions = 200; only legacy `competitivePricing v0` stays 403 (not used).

### Tables (created via mgmt-API SQL; hand-synced into database.types.ts)
- **`seller_order_finance`** (amazon_order_id PK) — per-order net from the Finances API: product_charges, shipping_charges, referral_fee, fba_fee, other_fees, fees_total, tax_collected, **net_proceeds**, refund_total, posted_date, `fee_breakdown` jsonb (incl. per-transaction `events`), raw.
- **`seller_sku_costs`** (seller_sku PK) — **`expected_in_hand`** (target net per unit after all Amazon deductions; the real input) + legacy cost/sell_price.
- **`seller_sku_pricing`** (seller_sku PK) — my_price, buybox_price, lowest_price, is_buybox_winner, offer_count, asin.
All RLS: read for manager/admin/logistics + seller uids; writes via service-role endpoints only.

### Sync
- **Orders/finance:** `seller-sync` also pulls `listFinancialEvents` (90-day window) → `seller_order_finance`. Parses Shipment + Refund + **ServiceFee (Easy Ship) + Chargeback + GuaranteeClaim** events; net_proceeds = sum of all signed amounts.
- **Pricing:** `/api/spapi/price-sync` (manager/Aaron/Kesh) prices the SKUs from `seller_sku_costs` ∪ ordered SKUs. `getPricing` (comma-separated Skus, batched 20) for own price; `getItemOffers` per ASIN (from order items) for Buy Box, capped ~200/run and **carries forward prior Buy Box** so repeating backfills the rest.
- **Costs:** `/api/spapi/sku-costs` (manager/Aaron/Kesh) — CSV/XLSX import + edit of expected-in-hand.

### Repricing logic
`floor price = expected_in_hand ÷ (1 − est_fee%)`; est_fee% = realized rate from settled orders (per-SKU from single-SKU orders, else account avg). Status: 🔴 below floor → raise · 🟢 clears target · 💡 can match Buy Box (Buy Box ≥ floor) · ⚠ Buy Box below floor. **Recommend-only — no price push yet** (Product Listing role is available for a future manager-confirmed push).
