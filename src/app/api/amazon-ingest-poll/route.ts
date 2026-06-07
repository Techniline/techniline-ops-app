import { runPoll } from "@/lib/amazon-ingest/poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mailbox poller for Amazon emails. Triggered by Vercel Cron (or manually).
 *
 * Auth:
 *  - Vercel Cron: `Authorization: Bearer <CRON_SECRET>` → runs LIVE (writes).
 *  - Manual: `x-ingest-secret: <AMAZON_INGEST_SECRET>` → DRY-RUN by default;
 *    pass `?mode=live` (or `?dryRun=false`) to write.
 *
 * Writes still require SUPABASE_SERVICE_ROLE_KEY + the `ingest_log` table;
 * fetching requires the AZURE_* Graph credentials. Missing config fails closed.
 */
async function handle(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const ingestSecret = process.env.AMAZON_INGEST_SECRET;

  const authHeader = request.headers.get("authorization");
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isManual =
    !!ingestSecret && request.headers.get("x-ingest-secret") === ingestSecret;

  if (!isCron && !isManual) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const lookbackHours =
    Number(
      url.searchParams.get("lookbackHours") ??
        process.env.INGEST_LOOKBACK_HOURS ??
        "48"
    ) || 48;

  // Cron writes by default; manual is dry-run unless explicitly live.
  const modeLive =
    url.searchParams.get("mode") === "live" ||
    url.searchParams.get("dryRun") === "false";
  const dryRun = isCron ? false : !modeLive;

  try {
    const summary = await runPoll({ dryRun, lookbackHours });
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Poll failed." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
