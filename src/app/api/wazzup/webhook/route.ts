import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Wazzup message webhook. Secured by ?secret=WAZZUP_WEBHOOK_SECRET.
 *  Stores inbound (customer) + outbound (agent) messages and, when an agent
 *  replies, stamps the matching inbound rows with their reply time in minutes.
 *  Replies 200 quickly (Wazzup retries on non-200). */
interface WzMsg {
  messageId?: string;
  chatId?: string;
  chatType?: string;
  dateTime?: string;
  isEcho?: boolean;
  status?: string;
  text?: string;
  contact?: { name?: string };
}

function direction(m: WzMsg): "inbound" | "outbound" {
  if (m.isEcho === true) return "outbound";
  return m.status === "inbound" ? "inbound" : "outbound";
}

export async function POST(request: Request): Promise<Response> {
  const secret = new URL(request.url).searchParams.get("secret");
  if (!process.env.WAZZUP_WEBHOOK_SECRET || secret !== process.env.WAZZUP_WEBHOOK_SECRET) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { test?: boolean; messages?: WzMsg[] };
  if (body.test) return Response.json({ ok: true }); // connection check

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: true }); // ack anyway so Wazzup doesn't retry-storm
  const svc = createClient(url, service, { auth: { persistSession: false } });

  const msgs = (body.messages ?? []).filter((m) => m.messageId);
  // Process oldest-first so reply matching is chronological.
  msgs.sort((a, b) => (a.dateTime ?? "").localeCompare(b.dateTime ?? ""));

  for (const m of msgs) {
    const dir = direction(m);
    const at = m.dateTime ?? new Date().toISOString();
    await svc.from("wazzup_messages").upsert(
      {
        message_id: m.messageId,
        chat_id: m.chatId ?? null,
        chat_type: m.chatType ?? null,
        direction: dir,
        contact_name: m.contact?.name ?? null,
        body: m.text ?? null,
        message_at: at,
        raw: m as never,
      },
      { onConflict: "message_id" }
    );

    // Agent reply → close out any earlier unanswered inbound in this chat.
    if (dir === "outbound" && m.chatId) {
      const { data: pending } = await svc
        .from("wazzup_messages")
        .select("id, message_at")
        .eq("chat_id", m.chatId)
        .eq("direction", "inbound")
        .is("response_minutes", null)
        .lte("message_at", at);
      for (const p of pending ?? []) {
        const mins = Math.max(0, Math.round((new Date(at).getTime() - new Date(p.message_at as string).getTime()) / 60000));
        await svc.from("wazzup_messages").update({ response_minutes: mins }).eq("id", p.id);
      }
    }
  }
  return Response.json({ ok: true });
}
