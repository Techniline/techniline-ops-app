import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { canViewStockReservation, canManageStockReservation } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export interface StockReservationAuth {
  uid: string;
  email: string | null;
  isManager: boolean;
  serviceClient: SupabaseClient;
}

function makeClients() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return null;
  return { url, anon, service };
}

/**
 * Authorize a stock-reservation API request from its Bearer token.
 * Returns null if the user isn't authenticated or lacks the capability.
 * `requireManager` = true enforces that the user also has the manager capability.
 */
export async function authorizeStockReservation(
  request: Request,
  requireManager = false
): Promise<StockReservationAuth | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const clients = makeClients();
  if (!clients) return null;

  const auth = createClient(clients.url, clients.anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;

  const svc = createClient(clients.url, clients.service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("id, role, portal_access").eq("id", data.user.id).maybeSingle();
  const profile = {
    id: data.user.id,
    role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null,
    portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;

  if (!canViewStockReservation(profile)) return null;
  const isMgr = canManageStockReservation(profile);
  if (requireManager && !isMgr) return null;

  return { uid: data.user.id, email: data.user.email ?? null, isManager: isMgr, serviceClient: svc };
}
