import { fetchNoonStatements } from "@/lib/noon/payments";
import { authorizeFinanceUser, serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { from_date?: string; to_date?: string };
  const toDate   = body.to_date   ?? new Date().toISOString().slice(0, 10);
  const fromDate = body.from_date ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  try {
    const statements = await fetchNoonStatements(fromDate, toDate);
    const db = serviceClient();
    let stmtUpserted = 0;
    let linesWritten = 0;
    let errors = 0;
    const errorSamples: string[] = [];

    for (const s of statements) {
      const { error: stmtErr } = await db.from("noon_statements").upsert(
        {
          statement_id:    s.statement_id,
          payment_date:    s.payment_date?.slice(0, 10) || null,
          period_from:     s.period_from?.slice(0, 10) || null,
          period_to:       s.period_to?.slice(0, 10) || null,
          gross_sales_aed: s.gross_sales ?? null,
          total_fees_aed:  s.total_fees ?? null,
          total_returns_aed: s.total_returns ?? null,
          net_amount_aed:  s.net_amount ?? null,
          status:          s.status ?? "paid",
          raw_data:        s,
          synced_at:       new Date().toISOString(),
        },
        { onConflict: "statement_id" },
      );
      if (stmtErr) {
        errors += 1;
        if (errorSamples.length < 3) errorSamples.push(`${s.statement_id}: ${stmtErr.message}`);
        continue;
      }
      stmtUpserted += 1;

      if (s.items?.length) {
        await db.from("noon_statement_lines").delete().eq("statement_id", s.statement_id);
        const lineRows = s.items.map((l) => ({
          statement_id:      s.statement_id,
          order_nr:          l.order_nr ?? null,
          transaction_type:  l.transaction_type ?? null,
          description:       l.description ?? null,
          sku:               l.sku ?? null,
          qty:               l.qty ?? null,
          unit_price_aed:    l.unit_price ?? null,
          amount_aed:        l.amount ?? null,
          transaction_date:  l.transaction_date?.slice(0, 10) ?? null,
        }));
        const { error: lineErr } = await db.from("noon_statement_lines").insert(lineRows);
        if (!lineErr) linesWritten += lineRows.length;
      }
    }

    return Response.json({ ok: true, fetched: statements.length, stmtUpserted, linesWritten, errors, errorSamples, fromDate, toDate });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error." }, { status: 500 });
  }
}
