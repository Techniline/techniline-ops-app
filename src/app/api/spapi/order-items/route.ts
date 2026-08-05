import { authorizeFinanceUser, serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spapi/order-items
 *  Returns lite order-item rows (amazon_order_id, seller_sku, item_price, quantity_ordered)
 *  for all synced orders via the service-role client, bypassing RLS. */
export async function GET(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const db = serviceClient();
  const { data, error } = await db
    .from("seller_order_items")
    .select("amazon_order_id, seller_sku, item_price, quantity_ordered")
    .limit(20000);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, items: data ?? [] });
}
