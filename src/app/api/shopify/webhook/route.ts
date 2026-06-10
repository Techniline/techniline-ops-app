import crypto from "node:crypto";

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shopify webhook receiver. Public endpoint, secured by HMAC verification against
 * SHOPIFY_WEBHOOK_SECRET (the webhook signing secret). On any sales-affecting
 * event it bumps a `shopify_sync` heartbeat row, which the dashboard subscribes
 * to (Supabase Realtime) for an instant refresh. We deliberately do no heavy
 * work here — Shopify needs a fast 200.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "unknown";

  const raw = await request.text();

  // Verify HMAC (base64 of HMAC-SHA256 over the raw body).
  if (!secret) {
    return Response.json({ ok: false, error: "Webhook secret not configured." }, { status: 503 });
  }
  const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  const ok =
    hmac.length === digest.length &&
    crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest));
  if (!ok) {
    return Response.json({ ok: false, error: "Invalid HMAC." }, { status: 401 });
  }

  // Bump the heartbeat (service role; table may not exist yet → fail soft).
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && service) {
    try {
      const svc = createClient(url, service, { auth: { persistSession: false } });
      await svc
        .from("shopify_sync")
        .upsert(
          { key: "mm", last_event_at: new Date().toISOString(), last_topic: topic },
          { onConflict: "key" }
        );
    } catch {
      /* never block the 200 to Shopify */
    }
  }

  return Response.json({ ok: true });
}
