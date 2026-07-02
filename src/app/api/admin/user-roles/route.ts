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
}

interface UserWithRoles {
  id: string;
  full_name: string | null;
  email: string;
  avatar_initials: string | null;
  role: string | null;
  active: boolean;
  portal_access: string[] | null;
  roles: Role[];
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

// GET /api/admin/user-roles — all users with their role assignments
export async function GET(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  const [usersRes, assignmentsRes] = await Promise.all([
    admin.svc
      .from("users")
      .select("id, full_name, email, avatar_initials, role, active, portal_access")
      .order("full_name"),
    admin.svc
      .from("user_role_assignments")
      .select("user_id, role:roles(id, name, description, capabilities, color, created_at)"),
  ]);

  if (usersRes.error) return Response.json({ ok: false, error: usersRes.error.message }, { status: 500 });
  if (assignmentsRes.error) return Response.json({ ok: false, error: assignmentsRes.error.message }, { status: 500 });

  // Build a map of user_id → roles[]
  const rolesByUser = new Map<string, Role[]>();
  for (const a of (assignmentsRes.data ?? [])) {
    const assignment = a as unknown as { user_id: string; role: Role | null };
    if (!assignment.role) continue;
    if (!rolesByUser.has(assignment.user_id)) rolesByUser.set(assignment.user_id, []);
    rolesByUser.get(assignment.user_id)!.push(assignment.role);
  }

  const users: UserWithRoles[] = (usersRes.data ?? []).map((u) => {
    const user = u as {
      id: string;
      full_name: string | null;
      email: string;
      avatar_initials: string | null;
      role: string | null;
      active: boolean;
      portal_access: string[] | null;
    };
    return {
      ...user,
      roles: rolesByUser.get(user.id) ?? [],
    };
  });

  return Response.json({ ok: true, users });
}

// POST /api/admin/user-roles — assign a role to a user
export async function POST(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  let body: { user_id: string; role_id: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { user_id, role_id } = body;
  if (!user_id) return Response.json({ ok: false, error: "user_id required." }, { status: 400 });
  if (!role_id) return Response.json({ ok: false, error: "role_id required." }, { status: 400 });

  const { error } = await admin.svc
    .from("user_role_assignments")
    .insert({ user_id, role_id, assigned_by: admin.uid });

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  await recomputePortalAccess(user_id, admin.svc);

  return Response.json({ ok: true });
}

// DELETE /api/admin/user-roles — remove a role from a user
export async function DELETE(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  let body: { user_id: string; role_id: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { user_id, role_id } = body;
  if (!user_id) return Response.json({ ok: false, error: "user_id required." }, { status: 400 });
  if (!role_id) return Response.json({ ok: false, error: "role_id required." }, { status: 400 });

  const { error } = await admin.svc
    .from("user_role_assignments")
    .delete()
    .eq("user_id", user_id)
    .eq("role_id", role_id);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  await recomputePortalAccess(user_id, admin.svc);

  return Response.json({ ok: true });
}
