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

/**
 * POST /api/admin/users
 * Body: { email, full_name, role, avatar_initials? }
 * Finds the Supabase Auth user by email and creates/upserts their public.users row.
 */
export async function POST(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  let body: { email?: string; full_name?: string; role?: string; avatar_initials?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  const role = body.role?.trim() ?? "user";

  if (!email) return Response.json({ ok: false, error: "Email is required." }, { status: 400 });
  if (!fullName) return Response.json({ ok: false, error: "Full name is required." }, { status: 400 });

  // Find the Supabase Auth user by email
  const { data: listData, error: listErr } = await admin.svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) return Response.json({ ok: false, error: `Could not query auth users: ${listErr.message}` }, { status: 500 });

  const authUser = (listData?.users ?? []).find((u) => u.email?.toLowerCase() === email);
  if (!authUser) {
    return Response.json({ ok: false, error: `No Supabase Auth user found with email ${email}. Create them in Supabase first.` }, { status: 404 });
  }

  const avatarInitials = body.avatar_initials?.trim()
    || fullName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const { error: upsertErr } = await admin.svc
    .from("users")
    .upsert(
      { id: authUser.id, email, full_name: fullName, role, avatar_initials: avatarInitials, active: true },
      { onConflict: "id" }
    );

  if (upsertErr) return Response.json({ ok: false, error: `Could not create user: ${upsertErr.message}` }, { status: 500 });

  return Response.json({ ok: true, id: authUser.id, email, full_name: fullName });
}

/**
 * PATCH /api/admin/users
 * Body: { id, full_name?, avatar_initials?, role? }
 * Updates a user's profile fields in public.users.
 */
export async function PATCH(request: Request): Promise<Response> {
  const admin = await authorizeAdmin(request);
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 403 });

  let body: { id?: string; full_name?: string; avatar_initials?: string; role?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.id) return Response.json({ ok: false, error: "User id is required." }, { status: 400 });

  const patch: Record<string, string> = {};
  if (body.full_name != null) patch.full_name = body.full_name.trim();
  if (body.avatar_initials != null) patch.avatar_initials = body.avatar_initials.trim().toUpperCase().slice(0, 2);
  if (body.role != null) patch.role = body.role.trim();

  if (Object.keys(patch).length === 0) return Response.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  const { error } = await admin.svc.from("users").update(patch).eq("id", body.id);
  if (error) return Response.json({ ok: false, error: `Update failed: ${error.message}` }, { status: 500 });

  return Response.json({ ok: true });
}
