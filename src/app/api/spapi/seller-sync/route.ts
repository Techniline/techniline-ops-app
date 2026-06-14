import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import {
  fetchFbaCustomerReturns,
  fetchFinancialEventGroups,
  fetchMfnReturns,
  fetchSellerOrders,
  sellerConfigured,
  type SellerReturn,
} from "@/lib/spapi/sellerClient";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LAST_SYNC_KEY = "seller_last_sync";
const DEFAULT_LOOKBACK_DAYS = 30;

/** Authorize: a manager session OR the cron secret. */
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

  const nowIso = new Date().toISOString();
  const result: { finance: number; orders: number; returns: number; warnings: string[] } = {
    finance: 0,
    orders: 0,
    returns: 0,
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

  // Orders — live order tracking / fulfillment (Orders API)
  try {
    const orders = await fetchSellerOrders(startedAfter);
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

  // Returns — FBA customer returns + seller-fulfilled (MFN) returns. Each report
  // is fetched independently so one failing (e.g. role/access) doesn't lose the
  // other. MFN is what Seller Central's Manage Returns list shows.
  const returns: SellerReturn[] = [];
  for (const [label, fn] of [
    ["FBA returns", fetchFbaCustomerReturns],
    ["MFN returns", fetchMfnReturns],
  ] as const) {
    try {
      returns.push(...(await fn(startedAfter)));
    } catch (e) {
      result.warnings.push(`${label}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  if (returns.length) {
    const rows = returns.map((r) => ({
      source_key:
        [r.source, r.orderId, r.sku, r.returnDate, r.fulfillmentCenter].filter(Boolean).join("|") ||
        `${r.source}|${JSON.stringify(r.raw).slice(0, 200)}`,
      source: r.source,
      order_id: r.orderId,
      sku: r.sku,
      asin: r.asin,
      return_date: r.returnDate,
      quantity: r.quantity,
      reason: r.reason,
      status: r.status,
      fulfillment_center: r.fulfillmentCenter,
      detailed_disposition: r.detailedDisposition,
      raw: r.raw as never,
      synced_at: nowIso,
      updated_at: nowIso,
    }));
    const { error } = await svc.from("seller_returns").upsert(rows, { onConflict: "source_key" });
    if (error) result.warnings.push(`returns upsert: ${error.message}`);
    else result.returns = rows.length;
  }

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
