import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { spapiConfigured, spapiProbe } from "@/lib/spapi/client";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function isManagerRequest(request: Request): Promise<boolean> {
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
  return isManager({ id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile);
}

/** Manager-only: probe which Vendor APIs / reports our roles allow. */
export async function GET(request: Request): Promise<Response> {
  if (!(await isManagerRequest(request))) {
    return Response.json({ ok: false, error: "Unauthorized (manager only)." }, { status: 401 });
  }
  if (!spapiConfigured()) return Response.json({ ok: false, error: "SP-API not configured." });
  const results = await spapiProbe();
  return Response.json({ ok: true, results });
}
