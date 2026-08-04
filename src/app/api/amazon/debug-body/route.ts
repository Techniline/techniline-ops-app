import { createClient } from "@supabase/supabase-js";

import { fetchBody, fetchMessages } from "@/lib/amazon-ingest/graph";
import { hasCapability, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return false;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return false;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc
    .from("users")
    .select("role, portal_access")
    .eq("id", data.user.id)
    .maybeSingle();
  const profile = {
    id: data.user.id,
    role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null,
    portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;
  return isManager(profile) || hasCapability(profile, "finance");
}

export async function GET(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const mailbox = "vihan@techniline.org";
    const sinceIso = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const headers = await fetchMessages(mailbox, sinceIso);
    const remittance = headers.find((m) =>
      (m.subject ?? "").toLowerCase().includes("remittance")
    );
    if (!remittance) {
      return Response.json({ ok: false, error: "No remittance email found in last 30 days." });
    }
    const body = await fetchBody(mailbox, remittance.id);
    const preview = body?.slice(0, 3000) ?? null;

    // Count columns in the first few <tr> rows
    const rowMatches = body ? [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, 20) : [];
    const rowInfo = rowMatches.map((m) => {
      const cells = [...m[1].matchAll(/<td[^>]*>/gi)];
      return { cols: cells.length, snippet: m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 100) };
    });

    return Response.json({
      ok: true,
      subject: remittance.subject,
      receivedAt: remittance.receivedDateTime,
      bodyLength: body?.length ?? 0,
      isHtml: body ? body.trim().startsWith("<") || body.includes("<td") : false,
      preview,
      rowInfo,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
