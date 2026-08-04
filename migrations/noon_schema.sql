-- Noon Seller module schema
-- Run in Supabase SQL editor.

-- ── Orders ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS noon_orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_nr          text        UNIQUE NOT NULL,
  order_date        date,
  status            text,           -- pending_fulfill, shipped, delivered, cancelled, returned
  payment_type      text,           -- prepaid, cod
  channel           text,           -- noon, noon_express
  customer_zone     text,           -- AE, SA, EG
  total_aed         numeric,
  item_count        int,
  sku               text,           -- first / primary SKU on the order
  qty               int,
  raw_data          jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_noon_orders_date ON noon_orders (order_date DESC);
CREATE INDEX IF NOT EXISTS idx_noon_orders_status ON noon_orders (status);

ALTER TABLE noon_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "noon_orders_team_read" ON noon_orders;
CREATE POLICY "noon_orders_team_read" ON noon_orders FOR SELECT TO authenticated USING (true);

-- ── Payment Statements ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS noon_statements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id      text        UNIQUE NOT NULL,   -- Noon payment statement reference
  payment_date      date,
  period_from       date,
  period_to         date,
  gross_sales_aed   numeric,
  total_fees_aed    numeric,
  total_returns_aed numeric,
  net_amount_aed    numeric,
  status            text        NOT NULL DEFAULT 'paid',  -- paid, pending
  raw_data          jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_noon_stmt_date ON noon_statements (payment_date DESC);

ALTER TABLE noon_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "noon_stmt_team_read" ON noon_statements;
CREATE POLICY "noon_stmt_team_read" ON noon_statements FOR SELECT TO authenticated USING (true);

-- ── Statement Line Items ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS noon_statement_lines (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id      text        NOT NULL REFERENCES noon_statements(statement_id) ON DELETE CASCADE,
  order_nr          text,
  transaction_type  text,  -- sale, return, fee, commission, fulfillment_fee, adjustment
  description       text,
  sku               text,
  qty               int,
  unit_price_aed    numeric,
  amount_aed        numeric,
  transaction_date  date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_noon_stmt_lines_stmt ON noon_statement_lines (statement_id);
CREATE INDEX IF NOT EXISTS idx_noon_stmt_lines_order ON noon_statement_lines (order_nr);

ALTER TABLE noon_statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "noon_stmt_lines_read" ON noon_statement_lines;
CREATE POLICY "noon_stmt_lines_read" ON noon_statement_lines FOR SELECT TO authenticated USING (true);

-- ── Returns ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS noon_returns (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id         text        UNIQUE NOT NULL,
  order_nr          text,
  return_date       date,
  reason            text,
  reason_details    text,
  status            text,   -- return_requested, items_returned, refunded, rejected
  sku               text,
  qty               int,
  return_amount_aed numeric,
  resolution        text,   -- refunded, replacement, rejected
  resolved_at       date,
  recon_remark      text,   -- free-text note (for accounts team)
  raw_data          jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_noon_returns_date ON noon_returns (return_date DESC);
CREATE INDEX IF NOT EXISTS idx_noon_returns_status ON noon_returns (status);
CREATE INDEX IF NOT EXISTS idx_noon_returns_order ON noon_returns (order_nr);

ALTER TABLE noon_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "noon_returns_team_read" ON noon_returns;
CREATE POLICY "noon_returns_team_read" ON noon_returns FOR SELECT TO authenticated USING (true);

-- ── Service-role write policies ──────────────────────────────────────────────
-- API sync routes use the service-role key, which bypasses RLS.
-- No explicit INSERT/UPDATE policies needed for service-role.
