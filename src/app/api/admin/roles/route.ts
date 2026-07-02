import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERUSER_UID = "c4abda49-13e9-41fd-acae-88acd4aa7fcb";

interface Role {
  id: string;
  name: string;
  description: string | null;
  capabilities: string[];
  color: string;
  created_at: string;
  created_by: string | null;
}

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

async function recomputePortalAccess(userId: string, svc: SupabaseClient): Promise<void> {
  const { data } = await svc
    .from("user_role_assignments")
    .select("role:roles(capabilities)")
    .eq("user_id", userId);
  const caps = [...new Set(
    (data ?? []).flatMap((a) => {
      const role = (a as unknown as { role: { capabilities: string[] } | null }).role;
      return role?.capabilities ?? [];
    })
  )];
  await svc.from("users").update({ portal_access: caps }).eq("id", userId);
}

// GET /api/admin/roles — return all roles ordered by name
export async function GET(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  const { data, error } = await admin.svc
    .from("roles")
    .select("id, name, description, capabilities, color, created_at, created_by")
    .order("name");

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, roles: data as Role[] });
}

// POST /api/admin/roles — create a new role
export async function POST(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  let body: { name: string; description?: string; capabilities: string[]; color?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, description, capabilities, color } = body;
  if (!name?.trim()) return Response.json({ ok: false, error: "name required." }, { status: 400 });
  if (!Array.isArray(capabilities)) return Response.json({ ok: false, error: "capabilities must be an array." }, { status: 400 });

  const { data, error } = await admin.svc
    .from("roles")
    .insert({
      name: name.trim(),
      description: description?.trim() ?? null,
      capabilities,
      color: color ?? "#6366f1",
      created_by: admin.uid,
    })
    .select("id, name, description, capabilities, color, created_at, created_by")
    .single();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, role: data as Role });
}
