import { createClient } from "@supabase/supabase-js";

import { canViewSellerOrders, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * Clear a pending Wazzup chat from the dashboard (managers + Aaron). For the
 * chat's still-unanswered inbound messages:
 *  - "replied"          → stamp response_minutes (counts as a reply).
 *  - "no_reply_needed"  → set no_reply_needed = true (handled, not a reply).
 */
export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service || !anon) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: u, error: authErr } = await auth.auth.getUser(token);
  if (authErr || !u.user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role, portal_access").eq("id", u.user.id).maybeSingle();
  const profile = { id: u.user.id, role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null, portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null } as UserProfile;
  if (!(isManager(profile) || canViewSellerOrders(profile))) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { chatId?: string; action?: string };
  const chatId = (body.chatId ?? "").trim();
  const action = body.action;
  if (!chatId) return Response.json({ ok: false, error: "Missing chatId." }, { status: 400 });
  if (action !== "replied" && action !== "no_reply_needed") {
    return Response.json({ ok: false, error: "Invalid action." }, { status: 400 });
  }

  // The chat's still-pending inbound messages.
  const { data: pending, error: selErr } = await svc
    .from("wazzup_messages")
    .select("id, message_at")
    .eq("chat_id", chatId)
    .eq("direction", "inbound")
    .is("response_minutes", null);
  if (selErr) return Response.json({ ok: false, error: selErr.message }, { status: 500 });

  const now = Date.now();
  let updated = 0;
  for (const p of pending ?? []) {
    const patch =
      action === "replied"
        ? { response_minutes: Math.max(0, Math.round((now - new Date((p as { message_at: string }).message_at).getTime()) / 60000)) }
        : { no_reply_needed: true };
    const { error } = await svc.from("wazzup_messages").update(patch as never).eq("id", (p as { id: string }).id);
    if (error) {
      return Response.json(
        { ok: false, error: `${error.message}. If it mentions no_reply_needed, run the wazzup_messages.no_reply_needed migration.` },
        { status: 500 }
      );
    }
    updated += 1;
  }

  return Response.json({ ok: true, updated });
}
