import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { canViewLogistics } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export interface LogisticsAuth {
  uid: string;
  email: string | null;
  serviceClient: SupabaseClient;
}

/**
 * Authorize a Logistics API request from its Bearer token. Returns the user id
 * and a service-role client, or null if the caller may not access logistics
 * (not authenticated, or lacks the logistics role/capability). Managers and the
 * dedicated logistics user pass; everyone else is rejected.
 */
export async function authorizeLogistics(request: Request): Promise<LogisticsAuth | null> {
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
  const profile = {
    id: data.user.id,
    role: (row as { role?: string } | null)?.role ?? null,
  } as UserProfile;

  if (!canViewLogistics(profile)) return null;
  return { uid: data.user.id, email: data.user.email ?? null, serviceClient: svc };
}
