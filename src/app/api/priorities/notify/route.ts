import { createClient } from "@supabase/supabase-js";

import { getGraphToken } from "@/lib/amazon-ingest/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Returns the user id iff the caller is an authenticated manager, else null. */
async function managerId(request: Request): Promise<string | null> {
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

  // Role check via service role (bypasses RLS for a reliable lookup).
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  return (row as { role?: string } | null)?.role === "manager" ? data.user.email ?? data.user.id : null;
}

/**
 * Send a notification email (assignment or weekly summary) via Microsoft Graph,
 * reusing the existing Azure app. Manager-only. The caller supplies recipients +
 * pre-rendered subject/html. Requires the Azure app to have **Mail.Send
 * (Application)** consented; sender = PRIORITY_MAIL_FROM (default vihan@).
 * Fail-soft by contract: the caller saves the priority first and only warns if
 * this returns non-ok.
 */
export async function POST(request: Request): Promise<Response> {
  const caller = await managerId(request);
  if (!caller) {
    return Response.json({ ok: false, error: "Unauthorized (manager only)." }, { status: 401 });
  }

  let body: { to?: unknown; subject?: unknown; html?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const to = Array.isArray(body.to) ? (body.to as unknown[]).filter((x): x is string => typeof x === "string" && x.includes("@")) : [];
  const subject = typeof body.subject === "string" ? body.subject : "";
  const html = typeof body.html === "string" ? body.html : "";
  if (to.length === 0 || !subject || !html) {
    return Response.json({ ok: false, error: "Missing recipients / subject / html." }, { status: 400 });
  }

  const sender = caller.includes("@") ? caller : process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
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
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Email send failed." },
      { status: 500 }
    );
  }
}
