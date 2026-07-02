import { createClient } from "@supabase/supabase-js";

import { canViewSellerOrders, isManager } from "@/lib/permissions";
import { fetchPipelineKpis, zohoConfigured } from "@/lib/zoho/client";
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
  const { data: row } = await svc.from("users").select("role, portal_access").eq("id", data.user.id).maybeSingle();
  const profile = { id: data.user.id, role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null, portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null } as UserProfile;
  return isManager(profile) || canViewSellerOrders(profile);
}

const PIPELINES = ["Back-to-Back Orders", "MusicMajlis"];

/** Read-only pipeline KPIs for the MM-relevant Zoho pipelines. */
export async function GET(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!zohoConfigured()) {
    return Response.json({ ok: true, configured: false, pipelines: [] });
  }
  try {
    const pipelines = await Promise.all(PIPELINES.map((p) => fetchPipelineKpis(p)));
    return Response.json({ ok: true, configured: true, pipelines });
  } catch (e) {
    return Response.json(
      { ok: false, configured: true, error: e instanceof Error ? e.message : "Zoho request failed." },
      { status: 502 }
    );
  }
}
