import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { fetchSkuPricing, sellerConfigured } from "@/lib/spapi/sellerClient";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manager + Aaron + Kesh may trigger a price sync. */
const SYNC_UIDS = new Set([
  "cbb81b27-8756-4f2d-bfe0-04211c27092c", // Aaron
  "4f0eaff3-3ce3-44de-8ed9-aa84246fc538", // Kesh
]);

async function authorize(token: string, url: string, anon: string, service: string): Promise<boolean> {
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return false;
  if (SYNC_UIDS.has(data.user.id)) return true;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  return isManager({ id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile);
}

/** Sync own price + Buy Box for the SKUs in the cost/expected-in-hand master. */
export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service || !anon) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const tok = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!tok || !(await authorize(tok, url, anon, service))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!sellerConfigured()) return Response.json({ ok: false, error: "Seller SP-API not configured." }, { status: 500 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  // SKUs to price = the expected-in-hand master ∪ every SKU we've seen in orders,
  // so pricing works even before any expected-in-hand is uploaded.
  const [{ data: costRows }, { data: itemRows }] = await Promise.all([
    svc.from("seller_sku_costs").select("seller_sku"),
    svc.from("seller_order_items").select("seller_sku, asin").not("seller_sku", "is", null).limit(20000),
  ]);
  const set = new Set<string>();
  const asinBySku = new Map<string, string>();
  for (const r of costRows ?? []) { const s = (r as { seller_sku: string | null }).seller_sku; if (s) set.add(s); }
  for (const r of itemRows ?? []) {
    const row = r as { seller_sku: string | null; asin: string | null };
    if (row.seller_sku) { set.add(row.seller_sku); if (row.asin && !asinBySku.has(row.seller_sku)) asinBySku.set(row.seller_sku, row.asin); }
  }
  const skus = [...set];
  if (skus.length === 0) {
    return Response.json({ ok: true, count: 0, note: "No SKUs known yet — run Sync now (orders) or import your product list first." });
  }

  // Carry forward Buy Box already fetched in prior runs, so this run's cap is
  // spent only on SKUs that still need it (progressive backfill).
  const { data: priorRows } = await svc
    .from("seller_sku_pricing")
    .select("seller_sku, asin, buybox_price, lowest_price, is_buybox_winner, offer_count");
  const prior = new Map<string, { buyboxPrice: number | null; lowestPrice: number | null; isBuyboxWinner: boolean | null; offerCount: number | null; asin: string | null }>();
  for (const r of priorRows ?? []) {
    const x = r as { seller_sku: string; asin: string | null; buybox_price: number | null; lowest_price: number | null; is_buybox_winner: boolean | null; offer_count: number | null };
    prior.set(x.seller_sku, { buyboxPrice: x.buybox_price, lowestPrice: x.lowest_price, isBuyboxWinner: x.is_buybox_winner, offerCount: x.offer_count, asin: x.asin });
  }

  const nowIso = new Date().toISOString();
  try {
    const pricing = await fetchSkuPricing(skus, { offersCap: 200, asinBySku, prior });
    const rows = pricing.map((p) => ({
      seller_sku: p.sellerSku,
      asin: p.asin,
      currency: p.currency,
      my_price: p.myPrice,
      buybox_price: p.buyboxPrice,
      lowest_price: p.lowestPrice,
      is_buybox_winner: p.isBuyboxWinner,
      offer_count: p.offerCount,
      raw: p.raw as never,
      synced_at: nowIso,
    }));
    if (rows.length) {
      const { error } = await svc.from("seller_sku_pricing").upsert(rows, { onConflict: "seller_sku" });
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
    const withBuyBox = rows.filter((r) => r.buybox_price != null).length;
    // SKUs that have an ASIN but still no Buy Box → will be picked up next run.
    const remaining = rows.filter((r) => r.asin != null && r.buybox_price == null).length;
    return Response.json({ ok: true, count: rows.length, withBuyBox, remaining, lastSync: nowIso });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Price sync failed." }, { status: 500 });
  }
}
