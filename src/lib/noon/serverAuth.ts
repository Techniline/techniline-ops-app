import { createClient } from "@supabase/supabase-js";

import { hasCapability, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

/** Extracts the Bearer token and verifies finance capability. Returns userId or null. */
export async function authorizeFinanceUser(request: Request): Promise<string | null> {
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
  const { data: row } = await svc.from("users").select("role, portal_access").eq("id", data.user.id).maybeSingle();
  const profile = {
    id: data.user.id,
    role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null,
    portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;
  return isManager(profile) || hasCapability(profile, "finance") ? data.user.id : null;
}

/** Service-role Supabase client for server-side writes (bypasses RLS). */
export function serviceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}
