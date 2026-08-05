import { authorizeFinanceUser, serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOON_REASON_MAP: Record<string, string> = {
  "damaged":             "damaged",
  "defective":           "damaged",
  "wrong item":          "wrong_item",
  "wrong_item":          "wrong_item",
  "not delivered":       "not_delivered",
  "not_delivered":       "not_delivered",
  "customer changed mind": "customer_return",
  "customer_return":     "customer_return",
  "unwanted":            "customer_return",
};

function mapReason(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  return NOON_REASON_MAP[key] ?? "other";
}

export async function POST(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const db = serviceClient();

  // Fetch all noon_returns
  const { data: noonReturns, error: fetchErr } = await db
    .from("noon_returns")
    .select("return_id, order_nr, return_date, reason, status, sku, qty, return_amount_aed, raw_data");
  if (fetchErr) return Response.json({ ok: false, error: fetchErr.message }, { status: 500 });

  // Fetch existing marketplace_returns for noon channel (to find which return_refs already exist)
  const { data: existing, error: existErr } = await db
    .from("marketplace_returns")
    .select("return_ref")
    .eq("channel", "noon");
  if (existErr) return Response.json({ ok: false, error: existErr.message }, { status: 500 });

  const existingRefs = new Set((existing ?? []).map((r) => r.return_ref).filter(Boolean));

  // Build insert rows for returns not yet in marketplace_returns
  const toInsert = (noonReturns ?? [])
    .filter((r) => !existingRefs.has(r.return_id))
    .map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = r.raw_data as any;
      const productTitle: string | null = raw?.product_title ?? null;
      return {
        channel:       "noon",
        return_ref:    r.return_id,
        order_ref:     r.order_nr ?? null,
        sku:           r.sku ?? null,
        product:       productTitle,
        qty:           r.qty ?? null,
        received_date: r.return_date ?? null,
        reason:        mapReason(r.reason),
        doc_status:    "pending",
        physical_status: "pending",
        notes:         r.reason ?? null,
        logged_by:     userId,
        logged_by_name: "Noon API sync",
        updated_at:    new Date().toISOString(),
      };
    });

  if (toInsert.length === 0) {
    return Response.json({ ok: true, inserted: 0, skipped: existingRefs.size, message: "All Noon returns already logged." });
  }

  const { error: insertErr } = await db.from("marketplace_returns").insert(toInsert);
  if (insertErr) return Response.json({ ok: false, error: insertErr.message }, { status: 500 });

  return Response.json({
    ok: true,
    inserted: toInsert.length,
    skipped: existingRefs.size,
    total: (noonReturns ?? []).length,
  });
}
