import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOOKBACK_DAYS = 120;

async function authorize(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return false;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return false;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  return isManager({ id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile);
}

function detectChannel(fulfillmentChannel: string | null, shipServiceLevel: string | null): string {
  const fc = (fulfillmentChannel ?? "").toUpperCase();
  const ssl = (shipServiceLevel ?? "").toLowerCase();
  if (fc === "AFN") return "amazon_df";
  if (ssl.includes("easy") || ssl.includes("easyship")) return "amazon_easy_ship";
  return "amazon_seller";
}

interface OrderRow {
  amazon_order_id: string;
  fulfillment_channel: string | null;
  ship_service_level: string | null;
  purchase_date: string | null;
}

interface ItemRow {
  amazon_order_id: string;
  seller_sku: string | null;
  asin: string | null;
  title: string | null;
  quantity_ordered: number | null;
}

export async function POST(request: Request): Promise<Response> {
  const ok = await authorize(request);
  if (!ok) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  let updated = 0;
  let created = 0;

  // ── Pass 1: Backfill product/asin for returns that have order_ref but are missing info ──
  const { data: toBackfill } = await svc
    .from("marketplace_returns")
    .select("id, order_ref, product, asin")
    .not("order_ref", "is", null)
    .or("product.is.null,asin.is.null");

  if (toBackfill && toBackfill.length > 0) {
    const orderRefs = [...new Set((toBackfill as { order_ref: string }[]).map((r) => r.order_ref))];

    const { data: items } = await svc
      .from("seller_order_items")
      .select("amazon_order_id, seller_sku, asin, title")
      .in("amazon_order_id", orderRefs);

    const infoByOrder = new Map<string, { title: string | null; asin: string | null }>();
    for (const item of (items ?? []) as ItemRow[]) {
      if (!infoByOrder.has(item.amazon_order_id)) {
        infoByOrder.set(item.amazon_order_id, { title: item.title, asin: item.asin });
      }
    }

    for (const r of toBackfill as { id: string; order_ref: string; product: string | null; asin: string | null }[]) {
      const info = infoByOrder.get(r.order_ref);
      if (!info) continue;
      const patch: Record<string, unknown> = {};
      if (info.title && !r.product) patch.product = info.title;
      if (info.asin && !r.asin) patch.asin = info.asin;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await svc.from("marketplace_returns").update(patch).eq("id", r.id);
      if (!error) updated++;
    }
  }

  // ── Pass 2: Create new returns from refunded orders in the finance table ──
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  const { data: refunds } = await svc
    .from("seller_order_finance")
    .select("amazon_order_id, posted_date, refund_total")
    .lt("refund_total", 0)
    .gte("posted_date", since);

  const refundOrderIds = ((refunds ?? []) as { amazon_order_id: string; posted_date: string | null; refund_total: number | null }[])
    .map((r) => r.amazon_order_id);

  if (refundOrderIds.length === 0) {
    return Response.json({ ok: true, updated, created });
  }

  // Skip orders already in marketplace_returns by order_ref
  const { data: existing } = await svc
    .from("marketplace_returns")
    .select("order_ref")
    .in("order_ref", refundOrderIds);

  const existingSet = new Set(((existing ?? []) as { order_ref: string | null }[]).map((r) => r.order_ref ?? ""));
  const newOrderIds = refundOrderIds.filter((id) => !existingSet.has(id));

  if (newOrderIds.length === 0) {
    return Response.json({ ok: true, updated, created });
  }

  const [ordersRes, itemsRes] = await Promise.all([
    svc
      .from("seller_orders")
      .select("amazon_order_id, fulfillment_channel, ship_service_level, purchase_date")
      .in("amazon_order_id", newOrderIds),
    svc
      .from("seller_order_items")
      .select("amazon_order_id, seller_sku, asin, title, quantity_ordered")
      .in("amazon_order_id", newOrderIds),
  ]);

  const ordersById = new Map<string, OrderRow>();
  for (const o of (ordersRes.data ?? []) as OrderRow[]) {
    ordersById.set(o.amazon_order_id, o);
  }

  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const item of (itemsRes.data ?? []) as ItemRow[]) {
    if (!itemsByOrder.has(item.amazon_order_id)) itemsByOrder.set(item.amazon_order_id, []);
    itemsByOrder.get(item.amazon_order_id)!.push(item);
  }

  const postedDateByOrder = new Map<string, string>();
  for (const r of (refunds ?? []) as { amazon_order_id: string; posted_date: string | null }[]) {
    if (r.posted_date) postedDateByOrder.set(r.amazon_order_id, r.posted_date);
  }

  for (const orderId of newOrderIds) {
    const order = ordersById.get(orderId);
    const items = itemsByOrder.get(orderId) ?? [];
    if (!items.length) continue; // no items synced yet — skip

    const channel = detectChannel(order?.fulfillment_channel ?? null, order?.ship_service_level ?? null);
    const receivedDate = postedDateByOrder.get(orderId)?.slice(0, 10) ?? null;
    const firstItem = items[0];
    const totalQty = items.reduce((s, i) => s + (i.quantity_ordered ?? 1), 0);

    const itemsJson = items.map((i) => ({
      sku: i.seller_sku,
      product: i.title,
      qty: i.quantity_ordered ?? 1,
      condition: null,
    }));

    const { error } = await svc.from("marketplace_returns").insert({
      channel,
      order_ref: orderId,
      asin: firstItem.asin,
      sku: firstItem.seller_sku,
      product: firstItem.title,
      qty: totalQty,
      received_date: receivedDate,
      physical_status: "received",
      doc_status: "pending",
      items: itemsJson,
      logged_by_name: "Amazon SP-API sync",
    });

    if (!error) created++;
  }

  return Response.json({ ok: true, updated, created });
}
