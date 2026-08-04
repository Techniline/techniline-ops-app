import { fetchNoonMessages } from "@/lib/noon/messages";
import { authorizeFinanceUser, serviceClient } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  await request.json().catch(() => ({}));

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
