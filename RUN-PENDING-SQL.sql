-- ============================================================================
-- Techniline Ops — consolidated pending migrations (run once, in order).
-- Safe to re-run: everything is "if not exists" / "create or replace" /
-- "drop policy if exists". Paste the whole file into Supabase → SQL Editor → Run.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A. CHECKLIST — Mon–Sat work week (no Sunday), cadence & staff leave        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- A0. Defensive: ensure the columns the generator needs exist (no-op if already
--     added by the earlier daily-checklist setup).
alter table public.task_definitions
  add column if not exists cadence text default 'daily',
  add column if not exists weekday integer,
  add column if not exists is_email_triggered boolean default false;

-- A1. Leave register + RLS
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

-- A2. Generator: skip Sunday, respect cadence, skip people on leave
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

-- A3. Clear today's (and any) wrongly-generated Sunday standing tasks that are
--     still open. Never touches completed or email-triggered/manual tasks.
DELETE FROM daily_tasks
WHERE EXTRACT(dow FROM task_date) = 0
  AND source = 'standing'
  AND status = 'open';


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ B. VENDOR POs — internal tracking fields on the PO detail panel            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.vendor_purchase_orders
  add column if not exists booking_date    date,
  add column if not exists booking_ref     text,
  add column if not exists internal_status text,
  add column if not exists internal_note   text,
  add column if not exists invoice_number  text;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ C. AMAZON SELLER CENTRAL — orders / finance / returns / return docs        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- C1. Finance: settlement / financial event groups
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

-- C2. Orders: live order tracking / fulfillment
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

-- C3. Return documentation (Maricel: invoice / PRT / SRT per Amazon order)
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

-- C4. Returns (FBA customer returns + seller-fulfilled MFN returns)
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
alter table public.seller_returns add column if not exists source text;  -- fba | mfn (for already-created tables)
create index if not exists seller_ret_date_idx on public.seller_returns (return_date desc);
create index if not exists seller_ret_order_idx on public.seller_returns (order_id);

-- C5. RLS
alter table public.seller_finance_groups enable row level security;
alter table public.seller_orders enable row level security;
alter table public.seller_order_docs enable row level security;
alter table public.seller_returns enable row level security;

-- Orders: Aaron + Maricel + Kesh (logistics) + managers
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

drop policy if exists seller_ret_read on public.seller_returns;
create policy seller_ret_read on public.seller_returns for select to authenticated
  using (public.current_user_role() in ('manager','admin','logistics')  -- + Kesh (Marketplace Returns)
         or auth.uid() = '227fdb27-80b5-4040-ab14-4bb945068af7'    -- Maricel
         or auth.uid() = 'cbb81b27-8756-4f2d-bfe0-04211c27092c');  -- Aaron

-- last-sync marker
insert into public.app_settings (key, value) values ('seller_last_sync', null)
on conflict (key) do nothing;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ G. AMAZON DELIVERY LIST — operational delivery/return fields on order docs  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Adds the columns the "Import delivery list" tool (Logistics → Amazon
-- Fulfillment) fills from the Amazon Seller Delivery List workbook. These live
-- on seller_order_docs (manual docs) — the API-synced seller_orders is untouched.

alter table public.seller_order_docs
  add column if not exists delivery_status    text,
  add column if not exists delivery_date       date,
  add column if not exists amazon_return_date  date,
  add column if not exists tracking_number     text,
  add column if not exists delivery_charge      numeric,
  add column if not exists delivery_address     text;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ H. QUALITY / ERROR LOG — channel + order/PO reference                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Adds the fields the improved Quality/Errors logger (Analytics → Appraisal)
-- captures: which channel the error was on, and the order/PO number.

alter table public.quality_log
  add column if not exists channel    text,
  add column if not exists order_ref  text;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ I. WAZZUP CHATS — "no reply needed" flag (in-app pending management)        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Lets Aaron clear a pending chat from the dashboard via "No reply needed"
-- (the Manage popup on the Chats card). "Replied" stamps response_minutes instead.

alter table public.wazzup_messages
  add column if not exists no_reply_needed boolean not null default false;

-- ============================================================================
-- Done. Expected: 0 errors. Then open the app: Checklist shows 0 tasks on
-- Sunday; Vendor PO detail saves invoice/booking; Amazon Seller Central →
-- "Sync now" populates Orders/Finance/Returns; Amazon Fulfillment →
-- "Import delivery list" backfills delivery status/tracking/PRT/SRT;
-- Analytics → Quality log captures channel + order/PO; Chats card → "Manage"
-- clears pending chats (replied / no reply needed).
-- ============================================================================
