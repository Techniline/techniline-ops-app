import { createClient } from "@supabase/supabase-js";

import { getGraphToken } from "@/lib/amazon-ingest/graph";
import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Manager-only: returns the caller's email iff they're a manager, else null. */
async function authorizedManager(request: Request): Promise<string | null> {
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
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  const profile = { id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile;
  return isManager(profile) ? data.user.email ?? null : null;
}

/**
 * Send the monthly operations summary to the Sales Head (manager-only). The
 * caller supplies the pre-rendered subject/html; fail-soft on Graph errors.
 */
export async function POST(request: Request): Promise<Response> {
  const callerEmail = await authorizedManager(request);
  if (!callerEmail) {
    return Response.json({ ok: false, error: "Unauthorized (manager only)." }, { status: 401 });
  }

  let body: { to?: unknown; subject?: unknown; html?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const to = Array.isArray(body.to)
    ? (body.to as unknown[]).filter((x): x is string => typeof x === "string" && x.includes("@"))
    : typeof body.to === "string" && body.to.includes("@")
      ? [body.to]
      : [];
  if (to.length === 0) {
    return Response.json({ ok: false, error: "Enter a valid recipient email." }, { status: 400 });
  }
  const subject = typeof body.subject === "string" && body.subject ? body.subject : "Techniline — Monthly Operations Summary";
  const html = typeof body.html === "string" ? body.html : "";
  if (!html) return Response.json({ ok: false, error: "Missing summary html." }, { status: 400 });

  const sender = callerEmail ?? process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
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
      return Response.json({ ok: false, error: `Graph sendMail ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    return Response.json({ ok: true, sentTo: to });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Email send failed." }, { status: 500 });
  }
}
