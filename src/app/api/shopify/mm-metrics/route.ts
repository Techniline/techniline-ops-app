import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { fetchMonthMetrics, shopifyConfigured } from "@/lib/shopify/client";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";

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
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  const profile = { id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile;
  return isManager(profile) || profile.id === AARON_ID;
}

/** Net sales + abandoned-cart count for the given month window (Shopify). */
export async function GET(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!shopifyConfigured()) {
    return Response.json({ ok: true, configured: false });
  }
  const u = new URL(request.url);
  const from = u.searchParams.get("from") ?? "";
  const to = u.searchParams.get("to") ?? "";
  if (!from || !to) {
    return Response.json({ ok: false, error: "Missing from/to." }, { status: 400 });
  }
  try {
    const m = await fetchMonthMetrics(from, to);
    return Response.json({ ok: true, configured: true, ...m });
  } catch (e) {
    return Response.json(
      { ok: false, configured: true, error: e instanceof Error ? e.message : "Shopify request failed." },
      { status: 502 }
    );
  }
}
