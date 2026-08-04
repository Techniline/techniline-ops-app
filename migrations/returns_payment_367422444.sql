-- Returns for Payment 367422444 — sourced from "2025 Pending SRT" + "Shortage Claim Deduction" sheets
-- Amazon vendor SOA 17-06-2022 (5).xlsx
-- Run in Supabase SQL editor. ON CONFLICT DO NOTHING is safe to re-run.

-- Ensure the check constraint covers all return_type values used by the app.
-- NOT VALID skips re-validation of existing rows (safe if existing data predates the constraint).
ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_return_type_check;
ALTER TABLE returns ADD CONSTRAINT returns_return_type_check
  CHECK (return_type IN ('vendor_return', 'return_dispute', 'shortage_claim', 'price_claim'))
  NOT VALID;

-- 20x NITROMAXKIT vendor returns (SRT/2600211, PRT/2600318, TLE WS2601644, PO 7CY8P5XQ)
INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319518016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611078', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319528016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611285', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319538016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610509', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319548016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610912', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319558016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610336', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319568016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610510', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319578016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610712', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319588016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611497', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319598016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610913', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319608016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610511', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319618016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611079', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319628016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611080', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319638016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611081', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319648016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611693', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319658016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611694', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319668016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610713', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319678016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611286', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319688016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611287', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319698016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500610714', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, tle_invoice_number, po_number, warehouse, model_sku, qty, total_cost_aed, srt_number, prt_number, source, status)
VALUES ('10011319708016', 'vendor_return', '2026-07-30', 'AMZN1P09G2U022UD', '7500611082', 'WS2601644', '7CY8P5XQ', 'XAEC', 'NITROMAXKIT', 1, 1588.65, 'SRT/2600211', 'PRT/2600318', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

-- HD400 — return dispute (DSPT20802419807)
INSERT INTO returns (return_id, return_type, date_received, amazon_invoice, po_number, warehouse, model_sku, qty, total_cost_aed, dispute_id_ref, source, status)
VALUES ('150015514829552', 'return_dispute', '2026-07-30', '7500615160', '63DM4AGP', 'DXB6', 'HD400', 1, 61.60, 'DSPT20802419807', 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

-- CL9 + RD9 — vendor returns (AMZN2NRTKNHD6H8S)
INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, po_number, warehouse, model_sku, qty, total_cost_aed, source, status)
VALUES ('149932325892552', 'vendor_return', '2026-07-30', 'AMZN2NRTKNHD6H8S', '7500618190', '7CII415N', 'DXB6', 'CL9', 1, 84.00, 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

INSERT INTO returns (return_id, return_type, date_received, authorization_id, amazon_invoice, po_number, warehouse, model_sku, qty, total_cost_aed, source, status)
VALUES ('149932325892552', 'vendor_return', '2026-07-30', 'AMZN2NRTKNHD6H8S', '7500617107', '7IF795CW', 'DXB7', 'RD9', 1, 1090.00, 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

-- WS2601417SC shortage claim (SRT/2600124, PRT/2600222)
INSERT INTO returns (return_id, return_type, date_received, amazon_invoice, tle_invoice_number, total_cost_aed, srt_number, prt_number, qty, source, status)
VALUES ('SC-WS2601417', 'shortage_claim', '2026-07-30', 'WS2601417', 'WS2601417', 2935.43, 'SRT/2600124', 'PRT/2600222', 1, 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;

-- WS2601502SC shortage claim (no SRT/dispute recorded in master file yet)
INSERT INTO returns (return_id, return_type, date_received, amazon_invoice, tle_invoice_number, total_cost_aed, qty, source, status)
VALUES ('SC-WS2601502', 'shortage_claim', '2026-07-30', 'WS2601502', 'WS2601502', 2289.00, 1, 'amazon_csv', 'open')
ON CONFLICT DO NOTHING;
