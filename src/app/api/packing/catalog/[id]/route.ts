import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUser(request: Request): Promise<{ id: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

function svcClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

/** PUT /api/packing/catalog/[id] — update a SKU */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
  return Response.json({ ok: true, item: data });
}

/** DELETE /api/packing/catalog/[id] — remove a SKU */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc.from("packing_sku_catalog" as any) as any).delete().eq("id", id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
