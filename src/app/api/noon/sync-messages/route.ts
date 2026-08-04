import { noonProbeUrl } from "@/lib/noon/client";
import { fetchNoonMessages } from "@/lib/noon/messages";
import { authorizeFinanceUser, serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROBE_CANDIDATES = [
  "https://mp-partners.noon.partners/_vs/mp/mp-buyer-message-api-sellerlab/buyer_message/list?page=1&limit=1",
  "https://mp-partners.noon.partners/_vs/mp/mp-communication-api-sellerlab/message/list?page=1&limit=1",
  "https://mp-partners.noon.partners/_vs/mp/mp-seller-inquiry-api-sellerlab/inquiry/list?page=1&limit=1",
  "https://mp-partners.noon.partners/_vs/mp/mp-messaging-api-sellerlab/message/list?page=1&limit=1",
  "https://mp-partners.noon.partners/_vs/mp/mp-crm-api-sellerlab/message/list?page=1&limit=1",
  "https://mp-partners.noon.partners/_vs/mp/mp-order-message-api-sellerlab/order_message/list?page=1&limit=1",
  "https://noon-api-gateway.noon.partners/seller/v1/messages?page=1&limit=1",
  "https://noon-api-gateway.noon.partners/seller/v1/buyer-messages?page=1&limit=1",
];

export async function POST(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { probe?: boolean };

  // ── Discovery mode ────────────────────────────────────────────────────────────
  if (body.probe) {
    const results: Record<string, string> = {};
    await Promise.all(
      PROBE_CANDIDATES.map(async (url) => {
        try {
          const { status, body: text } = await noonProbeUrl(url);
          results[url] = `${status} — ${text.slice(0, 120)}`;
        } catch (e) {
          results[url] = `error: ${e instanceof Error ? e.message.slice(0, 80) : "?"}`;
        }
      }),
    );
    const found = Object.entries(results)
      .filter(([, v]) => v.startsWith("200"))
      .map(([k]) => k);
    const summary = found.length
      ? `FOUND: ${found.join(" | ")}`
      : Object.entries(results).map(([k, v]) => `${v.slice(0, 3)} ${k.split("/").pop()}`).join(", ");
    return Response.json({ ok: true, probe: true, summary, results });
  }

  // ── Normal sync ───────────────────────────────────────────────────────────────
  try {
    const messages = await fetchNoonMessages();
    const db = serviceClient();
    let upserted = 0;
    let errors = 0;

    for (const m of messages) {
      const { error } = await db.from("noon_messages").upsert(
        {
          message_id: m.message_id,
          order_nr:   m.order_nr ?? null,
          thread_id:  m.thread_id ?? null,
          buyer_name: m.buyer_name ?? null,
          subject:    m.subject ?? null,
          body:       m.body ?? null,
          direction:  m.direction,
          sent_at:    m.sent_at ?? null,
          is_read:    m.is_read,
          replied:    m.replied,
          raw_data:   m,
          synced_at:  new Date().toISOString(),
        },
        { onConflict: "message_id" },
      );
      if (error) { errors += 1; } else { upserted += 1; }
    }

    return Response.json({ ok: true, fetched: messages.length, upserted, errors });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error." },
      { status: 500 },
    );
  }
}
