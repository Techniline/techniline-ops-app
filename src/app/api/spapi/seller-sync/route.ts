import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { fetchFinancialEventGroups, fetchFinancialEvents, fetchOrderItems, fetchSellerOrders, sellerConfigured } from "@/lib/spapi/sellerClient";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LAST_SYNC_KEY = "seller_last_sync";
const DEFAULT_LOOKBACK_DAYS = 30;

/** Non-manager users explicitly allowed to trigger a sync (Aaron, Kesh). */
const SYNC_UIDS = new Set([
  "cbb81b27-8756-4f2d-bfe0-04211c27092c", // Aaron
  "4f0eaff3-3ce3-44de-8ed9-aa84246fc538", // Kesh
]);

/** Authorize: a manager / Aaron / Kesh session, or the cron secret. */
async function authorize(request: Request, url: string, service: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) return false;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return false;
  if (SYNC_UIDS.has(data.user.id)) return true;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  return isManager({ id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile);
}

async function runSync(url: string, service: string): Promise<Response> {
  if (!sellerConfigured()) return Response.json({ ok: false, error: "Seller SP-API not configured." }, { status: 500 });
  const svc = createClient(url, service, { auth: { persistSession: false } });

  const { data: setting } = await svc.from("app_settings").select("value").eq("key", LAST_SYNC_KEY).maybeSingle();
  const last = (setting as { value?: string | null } | null)?.value ?? null;
  const startedAfter = last
    ? new Date(new Date(last).getTime() - 24 * 3600 * 1000).toISOString()
    : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();

  // Orders: always re-pull a rolling window by created date so Pending-payment
  // and older orders are never missed (cheap at this volume; upsert dedupes).
  const ordersCreatedAfter = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

  // Per-order financial events (fees / net proceeds) — rolling 90-day window so
  // newly-settled orders get their net captured.
  const financePostedAfter = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

  const nowIso = new Date().toISOString();
  const result: { finance: number; orders: number; items: number; orderFinance: number; warnings: string[] } = {
    finance: 0,
    orders: 0,
    items: 0,
    orderFinance: 0,
    warnings: [],
  };

  // Finance — settlement / financial event groups
  try {
    const groups = await fetchFinancialEventGroups(startedAfter);
    if (groups.length) {
      const rows = groups.map((g) => ({
        group_id: g.groupId,
        status: g.status,
        start_time: g.startTime,
        end_time: g.endTime,
        fund_transfer_date: g.fundTransferDate,
        currency: g.currency,
        original_total: g.originalTotal,
        converted_total: g.convertedTotal,
        raw: g.raw as never,
        synced_at: nowIso,
        updated_at: nowIso,
      }));
      const { error } = await svc.from("seller_finance_groups").upsert(rows, { onConflict: "group_id" });
      if (error) result.warnings.push(`finance: ${error.message}`);
      else result.finance = rows.length;
    }
  } catch (e) {
    result.warnings.push(`finance: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Per-order financials — fees + net proceeds (the "what we actually receive")
  try {
    const fin = await fetchFinancialEvents(financePostedAfter);
    if (fin.length) {
      const rows = fin.map((f) => ({
        amazon_order_id: f.amazonOrderId,
        currency: f.currency,
        product_charges: f.productCharges,
        shipping_charges: f.shippingCharges,
        promo_discount: f.promoDiscount,
        referral_fee: f.referralFee,
        fba_fee: f.fbaFee,
        other_fees: f.otherFees,
        fees_total: f.feesTotal,
        tax_collected: f.taxCollected,
        net_proceeds: f.netProceeds,
        refund_total: f.refundTotal,
        posted_date: f.postedDate,
        fee_breakdown: { referralFee: f.referralFee, fbaFee: f.fbaFee, otherFees: f.otherFees, events: f.events } as never,
        raw: f.raw as never,
        synced_at: nowIso,
      }));
      const { error } = await svc.from("seller_order_finance").upsert(rows, { onConflict: "amazon_order_id" });
      if (error) result.warnings.push(`orderFinance: ${error.message}`);
      else result.orderFinance = rows.length;
    }
  } catch (e) {
    result.warnings.push(`orderFinance: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Orders — live order tracking / fulfillment (Orders API)
  try {
    const orders = await fetchSellerOrders(ordersCreatedAfter);
    if (orders.length) {
      const rows = orders.map((o) => ({
        amazon_order_id: o.amazonOrderId,
        purchase_date: o.purchaseDate,
        last_update_date: o.lastUpdateDate,
        order_status: o.status,
        fulfillment_channel: o.fulfillmentChannel,
        sales_channel: o.salesChannel,
        ship_service_level: o.shipServiceLevel,
        items_shipped: o.itemsShipped,
        items_unshipped: o.itemsUnshipped,
        order_total: o.orderTotal,
        currency: o.currency,
        raw: o.raw as never,
        synced_at: nowIso,
        updated_at: nowIso,
      }));
      const { error } = await svc.from("seller_orders").upsert(rows, { onConflict: "amazon_order_id" });
      if (error) result.warnings.push(`orders: ${error.message}`);
      else result.orders = rows.length;
    }
  } catch (e) {
    result.warnings.push(`orders: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Order line items (invoice contents) — fetch for orders that don't have them
  // yet. getOrderItems is rate-limited (~0.5 req/s), so we throttle and cap the
  // batch; the next run picks up where this left off. Backfill spans a few runs.
  try {
    const { data: allOrders } = await svc
      .from("seller_orders")
      .select("amazon_order_id")
      .order("purchase_date", { ascending: false })
      .limit(2000);
    const { data: haveItems } = await svc.from("seller_order_items").select("amazon_order_id").limit(20000);
    const done = new Set((haveItems ?? []).map((r) => (r as { amazon_order_id: string }).amazon_order_id));
    const todo = (allOrders ?? [])
      .map((o) => (o as { amazon_order_id: string }).amazon_order_id)
      .filter((id) => !done.has(id))
      .slice(0, 100); // cap per run to stay within rate limit + function time

    for (const orderId of todo) {
      try {
        const items = await fetchOrderItems(orderId);
        if (items.length) {
          const rows = items.map((it) => ({
            amazon_order_id: orderId,
            order_item_id: it.orderItemId,
            asin: it.asin,
            seller_sku: it.sellerSku,
            title: it.title,
            quantity_ordered: it.quantityOrdered,
            quantity_shipped: it.quantityShipped,
            item_price: it.itemPrice,
            item_tax: it.itemTax,
            shipping_price: it.shippingPrice,
            shipping_tax: it.shippingTax,
            promotion_discount: it.promotionDiscount,
            currency: it.currency,
            raw: it.raw as never,
            synced_at: nowIso,
          }));
          const { error } = await svc.from("seller_order_items").upsert(rows, { onConflict: "order_item_id" });
          if (!error) result.items += rows.length;
          else result.warnings.push(`items ${orderId}: ${error.message}`);
        }
      } catch (e) {
        result.warnings.push(`items ${orderId}: ${e instanceof Error ? e.message.slice(0, 80) : "failed"}`);
      }
      await new Promise((r) => setTimeout(r, 1500)); // throttle for the rate limit
    }
  } catch (e) {
    result.warnings.push(`items: ${e instanceof Error ? e.message : "failed"}`);
  }

  // Returns are NOT synced — the MFN returns report needs the Direct to Consumer
  // Shipping role (Amazon declined, Jun 2026). Returns are logged manually in the
  // Marketplace Returns page.

  await svc.from("app_settings").upsert({ key: LAST_SYNC_KEY, value: nowIso }, { onConflict: "key" });
  return Response.json({ ok: true, ...result, lastSync: nowIso });
}

/** Manual sync — manager session or cron secret. */
export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  if (!(await authorize(request, url, service))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  return runSync(url, service);
}

/** Scheduled sync — Vercel Cron hits this with GET + the CRON_SECRET bearer. */
export async function GET(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return runSync(url, service);
}
