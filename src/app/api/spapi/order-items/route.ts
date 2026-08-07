import { createClient } from "@supabase/supabase-js";

import { serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spapi/order-items
 *  Returns lite order-item rows (amazon_order_id, seller_sku, item_price, quantity_ordered)
 *  for all synced orders via the service-role client, bypassing RLS.
 *  Auth: any authenticated user (same as sku-costs GET). */
export async function GET(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: u, error: authErr } = await auth.auth.getUser(token);
  if (authErr || !u.user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const db = serviceClient();
  const { data, error } = await db
    .from("seller_order_items")
    .select("amazon_order_id, seller_sku, item_price, quantity_ordered")
    .limit(20000);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, items: data ?? [] });
}
