import { fetchNoonOrders } from "@/lib/noon/orders";
import { authorizeFinanceUser, serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { from_date?: string; to_date?: string };
  const toDate = body.to_date ?? new Date().toISOString().slice(0, 10);
  const fromDate = body.from_date ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  try {
    const orders = await fetchNoonOrders(fromDate, toDate);
    const db = serviceClient();
    let upserted = 0;
    let errors = 0;

    for (const o of orders) {
      const firstItem = o.items?.[0];
      const { error } = await db.from("noon_orders").upsert(
        {
          order_nr: o.order_nr,
          order_date: o.order_date?.slice(0, 10) ?? null,
          status: o.status ?? null,
          payment_type: o.payment_type ?? null,
          channel: o.channel ?? null,
          customer_zone: o.customer_zone ?? null,
          total_aed: o.total_amount ?? null,
          item_count: o.items?.length ?? null,
          sku: firstItem?.sku ?? null,
          qty: o.items?.reduce((s, i) => s + (i.qty ?? 0), 0) ?? null,
          raw_data: o,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "order_nr" },
      );
      if (error) { errors += 1; } else { upserted += 1; }
    }

    return Response.json({ ok: true, fetched: orders.length, upserted, errors, fromDate, toDate });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error." }, { status: 500 });
  }
}
