import { createClient } from "@supabase/supabase-js";

import { getGraphToken } from "@/lib/amazon-ingest/graph";
import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

async function authorized(request: Request): Promise<string | null> {
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
  return isManager(profile) || profile.id === MARICEL_ID ? data.user.email ?? data.user.id : null;
}

const emails = (s: unknown): string[] =>
  typeof s === "string"
    ? s.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x.includes("@"))
    : [];

/** Send a remittance reconciliation email to accounts (To + CC), manager or Maricel. */
export async function POST(request: Request): Promise<Response> {
  const caller = await authorized(request);
  if (!caller) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  let b: { to?: unknown; cc?: unknown; subject?: unknown; html?: unknown };
  try {
    b = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const to = emails(b.to);
  const cc = emails(b.cc);
  if (to.length === 0) return Response.json({ ok: false, error: "Enter at least one valid recipient." }, { status: 400 });
  const subject = typeof b.subject === "string" && b.subject ? b.subject : "Remittance reconciliation";
  const html = typeof b.html === "string" ? b.html : "";
  if (!html) return Response.json({ ok: false, error: "Missing email body." }, { status: 400 });

  const sender = caller.includes("@") ? caller : process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
  try {
    const token = await getGraphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
          ccRecipients: cc.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return Response.json({ ok: false, error: `Graph sendMail ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    return Response.json({ ok: true, sentTo: to, cc });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Email send failed." }, { status: 500 });
  }
}
