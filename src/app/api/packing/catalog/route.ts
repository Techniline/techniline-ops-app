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

/** Fetch all rows from a paginated Supabase query in batches of 1000. */
async function fetchAll(
  svc: ReturnType<typeof svcClient>,
  buildQuery: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<{ rows: unknown[]; error: string | null }> {
  const BATCH = 1000;
  const rows: unknown[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + BATCH - 1);
    if (error) return { rows: [], error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return { rows, error: null };
}

/** GET /api/packing/catalog?q=&brand=&brands=1 — search SKU catalog or return distinct brand list */
export async function GET(request: Request): Promise<Response> {
  if (!(await getUser(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const brand = (searchParams.get("brand") ?? "").trim();

  const svc = svcClient();

  // brands=1 — return distinct brand names only (paginate to get all)
  if (searchParams.get("brands") === "1") {
    const { rows, error } = await fetchAll(svc, (from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc.from("packing_sku_catalog" as any) as any)
        .select("brand")
        .not("brand", "is", null)
        .order("brand", { ascending: true })
        .range(from, to) as Promise<{ data: unknown[] | null; error: { message: string } | null }>
    );
    if (error) return Response.json({ ok: false, error }, { status: 500 });
    const brands = [...new Set((rows as { brand: string }[]).map((r) => r.brand).filter(Boolean))].sort();
    return Response.json({ ok: true, brands });
  }

  // Full catalog fetch — paginate through all rows
  const { rows, error } = await fetchAll(svc, (from, to) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bq = (svc.from("packing_sku_catalog" as any) as any)
      .select("*")
      .order("brand", { ascending: true })
      .order("model_no", { ascending: true })
      .range(from, to);
    if (q) bq = bq.or(`model_no.ilike.%${q}%,description.ilike.%${q}%,brand.ilike.%${q}%`);
    if (brand) bq = bq.eq("brand", brand);
    return bq as Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  });

  if (error) return Response.json({ ok: false, error }, { status: 500 });
  return Response.json({ ok: true, items: rows });
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
