import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERUSER_UID = "c4abda49-13e9-41fd-acae-88acd4aa7fcb";

function makeServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false } });
}

async function authorizeAdmin(request: Request): Promise<{ uid: string; svc: SupabaseClient } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;

  const svc = makeServiceClient();
  if (!svc) return null;

  const uid = data.user.id;
  if (uid === SUPERUSER_UID) return { uid, svc };

  const { data: row } = await svc.from("users").select("role").eq("id", uid).maybeSingle();
  const role = (row as { role?: string } | null)?.role ?? null;
  if (role !== "manager") return null;

  return { uid, svc };
}

/** PATCH /api/admin/user-capabilities
 *  Body: { user_id: string, portal_access: string[] }
 *  Directly sets the user's portal_access. Role assignment still recomputes this —
 *  re-apply after role changes if needed. */
export async function PATCH(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  let body: { user_id: string; portal_access: string[] };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { user_id, portal_access } = body;
  if (!user_id) return Response.json({ ok: false, error: "user_id required." }, { status: 400 });
  if (!Array.isArray(portal_access)) return Response.json({ ok: false, error: "portal_access must be an array." }, { status: 400 });
  if (user_id === SUPERUSER_UID) return Response.json({ ok: false, error: "Cannot modify superuser access." }, { status: 403 });

  const { error } = await admin.svc.from("users").update({ portal_access }).eq("id", user_id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
