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

// PATCH /api/admin/roles/[id] — update a role and recompute affected users' portal_access
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  const { id } = await params;
  if (!id) return Response.json({ ok: false, error: "Role id required." }, { status: 400 });

  let body: { name?: string; description?: string; capabilities?: string[]; color?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description?.trim() ?? null;
  if (body.capabilities !== undefined) patch.capabilities = body.capabilities;
  if (body.color !== undefined) patch.color = body.color;

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  const { error: updateErr } = await admin.svc
    .from("roles")
    .update(patch)
    .eq("id", id);

  if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 500 });

  // Recompute portal_access for all users assigned this role.
  const { data: assignments } = await admin.svc
    .from("user_role_assignments")
    .select("user_id")
    .eq("role_id", id);

  if (assignments && assignments.length > 0) {
    await Promise.all(
      (assignments as { user_id: string }[]).map((a) => recomputePortalAccess(a.user_id, admin.svc))
    );
  }

  return Response.json({ ok: true });
}

// DELETE /api/admin/roles/[id] — delete a role and recompute affected users' portal_access
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  const { id } = await params;
  if (!id) return Response.json({ ok: false, error: "Role id required." }, { status: 400 });

  // Fetch assignments BEFORE deleting so we know which users to recompute.
  const { data: assignments } = await admin.svc
    .from("user_role_assignments")
    .select("user_id")
    .eq("role_id", id);

  const affectedUserIds = (assignments ?? []).map((a) => (a as { user_id: string }).user_id);

  const { error: deleteErr } = await admin.svc
    .from("roles")
    .delete()
    .eq("id", id);

  if (deleteErr) return Response.json({ ok: false, error: deleteErr.message }, { status: 500 });

  // Recompute portal_access for all previously-assigned users.
  if (affectedUserIds.length > 0) {
    await Promise.all(affectedUserIds.map((uid) => recomputePortalAccess(uid, admin.svc)));
  }

  return Response.json({ ok: true });
}
