import { executePlan, parseEmail } from "@/lib/amazon-ingest";
import type { IngestPayload, IngestResponse } from "@/lib/amazon-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/amazon-email-ingest
 *
 * Receives an Amazon email payload, classifies it, and plans upserts into the
 * operational tables. Requires the `x-ingest-secret` header to match
 * AMAZON_INGEST_SECRET. Defaults to DRY-RUN: it only writes when the body
 * explicitly sets `dryRun: false`. Writes use the server-side service role.
 */
export async function POST(request: Request): Promise<Response> {
  const configured = process.env.AMAZON_INGEST_SECRET;
  if (!configured) {
    return Response.json(
      { ok: false, error: "Ingest secret not configured on server." },
      { status: 500 }
    );
  }

  const provided = request.headers.get("x-ingest-secret");
  if (!provided || provided !== configured) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let payload: IngestPayload;
  try {
    payload = (await request.json()) as IngestPayload;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseEmail(payload);

  // Fail safe: only write when dryRun is *explicitly* false.
  const dryRun = payload.dryRun !== false;

  if (dryRun) {
    const body: IngestResponse = {
      ok: true,
      dryRun: true,
      type: parsed.type,
      fields: parsed.fields,
      notes: parsed.notes,
      operations: parsed.operations,
    };
    return Response.json(body);
  }

  try {
    const executed = await executePlan(parsed.operations);
    const body: IngestResponse = {
      ok: true,
      dryRun: false,
      type: parsed.type,
      fields: parsed.fields,
      notes: parsed.notes,
      operations: executed,
    };
    return Response.json(body);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Ingest failed." },
      { status: 500 }
    );
  }
}
