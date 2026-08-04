/** Typed shapes returned by the Noon Seller API v2. */

export interface NoonOrderItem {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  sale_price: number;
  status?: string;
  awb_nr?: string;
  shipment_nr?: string;
  is_fbn?: boolean;
}

export interface NoonOrder {
  order_nr: string;
  order_date: string;        // "YYYY-MM-DD HH:mm:ss"
  status: string;
  payment_type: string;
  channel: string;
  customer_zone: string;
  total_amount: number;
  items: NoonOrderItem[];
}

export interface NoonOrdersResult {
  records: NoonOrder[];
  total_records: number;
}

export interface NoonReturnItem {
  sku: string;
  qty: number;
  return_reason: string;
  item_amount: number;
}

export interface NoonReturn {
  return_id: string;
  order_nr: string;
  return_date: string;
  status: string;
  return_reason: string;
  return_reason_details?: string;
  product_title?: string;
  items: NoonReturnItem[];
  total_return_amount: number;
  resolution?: string;
}

export interface NoonReturnsResult {
  records: NoonReturn[];
  total_records: number;
}

export interface NoonStatementLine {
  order_nr?: string;
  transaction_type: string;
  description: string;
  sku?: string;
  qty?: number;
  unit_price?: number;
  amount: number;
  transaction_date: string;
}

export interface NoonStatement {
  statement_id: string;
  payment_date: string;
  period_from: string;
  period_to: string;
  gross_sales: number;
  total_fees: number;
  total_returns: number;
  net_amount: number;
  status: string;
  items?: NoonStatementLine[];
}

export interface NoonStatementsResult {
  records: NoonStatement[];
  total_records: number;
}

export interface NoonMessage {
  message_id: string;
  order_nr?: string;
  thread_id?: string;
  buyer_name?: string;
  subject?: string;
  body: string;
  direction: "inbound" | "outbound";
  sent_at: string;
  is_read: boolean;
  replied: boolean;
}
