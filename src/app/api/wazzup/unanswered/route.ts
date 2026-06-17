import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy for Wazzup's unanswered-messages counter — the number that respects the
 * "No reply needed" / "Mark as read" buttons in the Wazzup chat. Keeps the API
 * key server-side. Requires a signed-in user (Bearer token).
 *
 * Env: WAZZUP_API_KEY (the integration key), WAZZUP_USER_ID (the Wazzup user
 * whose counter to read — usually the shared inbox owner / Aaron).
 *
 * GET                 → { ok, configured, count, type, at }
 * GET ?users=1        → { ok, users:[{id,name}] }  (one-off: find the user id)
 */
export async function GET(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server not configured." }, { status: 500 });

  // Require an authenticated user (don't expose the proxy publicly).
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: u, error } = await auth.auth.getUser(token);
  if (error || !u.user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const apiKey = process.env.WAZZUP_API_KEY;
  if (!apiKey) return Response.json({ ok: true, configured: false });

  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // One-off helper to discover the Wazzup user id for WAZZUP_USER_ID.
  if (new URL(request.url).searchParams.get("users") === "1") {
    try {
      const r = await fetch("https://api.wazzup24.com/v3/users", { headers });
      const j = (await r.json().catch(() => ({}))) as { data?: { id: string; name?: string }[] } | { id: string; name?: string }[];
      const list = Array.isArray(j) ? j : (j.data ?? []);
      return Response.json({ ok: true, users: list.map((x) => ({ id: x.id, name: x.name ?? null })) });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : "Wazzup users fetch failed." }, { status: 502 });
    }
  }

  // Read-only diagnostics: show what the account actually exposes (raw responses,
  // no writes) so we can see if there are users and whether an account-wide
  // unanswered counter works without a user id.
  if (new URL(request.url).searchParams.get("probe") === "1") {
    const out: Record<string, unknown> = {};
    for (const [label, u] of [
      ["users", "https://api.wazzup24.com/v3/users"],
      ["unanswered_no_id", "https://api.wazzup24.com/v3/unanswered"],
      ["channels", "https://api.wazzup24.com/v3/channels"],
    ] as const) {
      try {
        const r = await fetch(u, { headers });
        const text = await r.text();
        out[label] = { status: r.status, body: text.slice(0, 1500) };
      } catch (e) {
        out[label] = { error: e instanceof Error ? e.message : "fetch failed" };
      }
    }
    return Response.json({ ok: true, probe: out });
  }

  const userId = process.env.WAZZUP_USER_ID;
  if (!userId) return Response.json({ ok: true, configured: false, needsUserId: true });

  try {
    const r = await fetch(`https://api.wazzup24.com/v3/unanswered/${encodeURIComponent(userId)}`, { headers });
    if (!r.ok) return Response.json({ ok: false, error: `Wazzup ${r.status}` }, { status: 502 });
    const j = (await r.json().catch(() => ({}))) as { counterV2?: number; counter?: number; type?: string; lastMsgDateTime?: string };
    const count = typeof j.counterV2 === "number" ? j.counterV2 : typeof j.counter === "number" ? j.counter : 0;
    return Response.json({ ok: true, configured: true, count, type: j.type ?? null, at: j.lastMsgDateTime ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Wazzup counter fetch failed." }, { status: 502 });
  }
}
