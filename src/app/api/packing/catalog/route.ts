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

/** GET /api/packing/catalog?q=&brand=&brands=1 — search SKU catalog or return distinct brand list */
export async function GET(request: Request): Promise<Response> {
  if (!(await getUser(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const brand = (searchParams.get("brand") ?? "").trim();

  // brands=1 — return distinct brand names only
  if (searchParams.get("brands") === "1") {
    const svc = svcClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
      .select("brand")
      .not("brand", "is", null)
      .order("brand", { ascending: true })
      .limit(500);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    const brands = [...new Set((data as { brand: string }[]).map((r) => r.brand).filter(Boolean))].sort();
    return Response.json({ ok: true, brands });
  }

  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (svc.from("packing_sku_catalog" as any) as any)
    .select("*")
    .order("brand", { ascending: true })
    .order("model_no", { ascending: true })
    .limit(500);

  if (q) {
    query = query.or(`model_no.ilike.%${q}%,description.ilike.%${q}%,brand.ilike.%${q}%`);
  }
  if (brand) {
    query = query.eq("brand", brand);
  }

  const { data, error } = await query;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, items: data ?? [] });
}

/** POST /api/packing/catalog — create a new SKU */
export async function POST(request: Request): Promise<Response> {
  const user = await getUser(request);
  if (!user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
    .insert({ ...body, created_by: user.id, source: "manual" })
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
  return Response.json({ ok: true, item: data }, { status: 201 });
}
