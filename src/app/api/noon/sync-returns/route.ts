import { fetchNoonReturns } from "@/lib/noon/returns";
import { authorizeFinanceUser, serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  // Date params accepted but not used — the FBP returns API returns all returns regardless of date
  const body = (await request.json().catch(() => ({}))) as { from_date?: string; to_date?: string };
  const toDate   = body.to_date   ?? new Date().toISOString().slice(0, 10);
  const fromDate = body.from_date ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  try {
    const returns = await fetchNoonReturns(fromDate, toDate);
    const db = serviceClient();
    let upserted = 0;
    let errors = 0;

    // Remove synthetic returns from old finance-export approach (prefixed RET_)
    await db.from("noon_returns").delete().like("return_id", "RET_%");

    for (const r of returns) {
      const firstItem = r.items?.[0];
      const { error } = await db.from("noon_returns").upsert(
        {
          return_id:         r.return_id,
          order_nr:          r.order_nr ?? null,
          return_date:       r.return_date?.slice(0, 10) || null,
          reason:            r.return_reason ?? null,
          reason_details:    r.return_reason_details ?? null,
          status:            r.status ?? null,
          sku:               firstItem?.sku ?? null,
          qty:               r.items?.reduce((s, i) => s + (i.qty ?? 0), 0) ?? null,
          return_amount_aed: r.total_return_amount || null,
          resolution:        r.resolution ?? null,
          raw_data:          r,
          synced_at:         new Date().toISOString(),
        },
        { onConflict: "return_id" },
      );
      if (error) { errors += 1; } else { upserted += 1; }
    }

    return Response.json({ ok: true, fetched: returns.length, upserted, errors, fromDate, toDate });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error." }, { status: 500 });
  }
}
