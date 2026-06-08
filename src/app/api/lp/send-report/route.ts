import { createClient } from "@supabase/supabase-js";

import { getGraphToken } from "@/lib/amazon-ingest/graph";
import { hasCapability, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Returns the user id iff the caller is authenticated AND may use LP Tracker
 * (a manager, or a holder of the `lp_tracker` capability — i.e. Maricel), else
 * null. Mirrors the priorities/notify auth but widened beyond manager-only.
 */
async function authorizedId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return null;

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  const profile = {
    id: data.user.id,
    role: (row as { role?: string } | null)?.role ?? null,
  } as UserProfile;
  return isManager(profile) || hasCapability(profile, "lp_tracker") ? profile.id : null;
}

/**
 * Send the LP stock-in-hand report to impex@techniline.org (or a caller-chosen
 * recipient) via Microsoft Graph, reusing the existing Azure app. The caller
 * supplies the pre-rendered subject/html snapshot. Fail-soft: the page shows a
 * warning if this returns non-ok; no data is ever lost.
 */
export async function POST(request: Request): Promise<Response> {
  const uid = await authorizedId(request);
  if (!uid) {
    return Response.json({ ok: false, error: "Unauthorized (LP Tracker access required)." }, { status: 401 });
  }

  let body: { to?: unknown; subject?: unknown; html?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const requested = Array.isArray(body.to)
    ? (body.to as unknown[]).filter((x): x is string => typeof x === "string" && x.includes("@"))
    : [];
  const to = requested.length > 0 ? requested : ["impex@techniline.org"];
  const subject = typeof body.subject === "string" && body.subject ? body.subject : "Local Purchase — Stock in Hand";
  const html = typeof body.html === "string" ? body.html : "";
  if (!html) {
    return Response.json({ ok: false, error: "Missing report html." }, { status: 400 });
  }

  const sender = process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
  try {
    const token = await getGraphToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "HTML", content: html },
            toRecipients: to.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: true,
        }),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      return Response.json(
        { ok: false, error: `Graph sendMail ${res.status}: ${t.slice(0, 200)}` },
        { status: 502 }
      );
    }
    return Response.json({ ok: true, sentTo: to });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Email send failed." },
      { status: 500 }
    );
  }
}
