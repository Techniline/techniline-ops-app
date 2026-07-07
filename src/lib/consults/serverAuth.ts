import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canViewConsults } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export interface ConsultsAuth {
  uid: string;
  email: string | null;
  serviceClient: SupabaseClient;
}

function makeClients() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return null;
  return { url, anon, service };
}

export async function authorizeConsults(request: Request): Promise<ConsultsAuth | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const clients = makeClients();
  if (!clients) return null;

  const authClient = createClient(clients.url, clients.anon, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;

  const svc = createClient(clients.url, clients.service, { auth: { persistSession: false } });
  const { data: row } = await svc
    .from("users")
    .select("id, role, portal_access")
    .eq("id", data.user.id)
    .maybeSingle();

  const profile = {
    id: data.user.id,
    role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null,
    portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;

  if (!canViewConsults(profile)) return null;
  return { uid: data.user.id, email: data.user.email ?? null, serviceClient: svc };
}

/** Service-role client for public (unauthenticated) operations like creating a booking. */
export function makeServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false } });
}
