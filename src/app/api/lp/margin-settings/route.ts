import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAVITHRAN_UID = "648993fe-d2e7-446a-ad71-c7b3ff81fae7";

function extractToken(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function makeServiceClient(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } });
}

async function resolveAndAuthorise(url: string, anon: string, service: string, token: string) {
  const anonClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data } = await anonClient.auth.getUser(token);
  const user = data.user;
  if (!user) return null;
  if (user.id === PAVITHRAN_UID) return user;
  const svc = makeServiceClient(url, service);
  const { data: row } = await svc.from("users").select("role").eq("id", user.id).maybeSingle();
  const role = (row as { role?: string } | null)?.role;
  if (role === "manager") return user;
  return null;
}

/** GET — returns { globalPct, brandMargins } */
export async function GET(request: Request): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service)
    return Response.json({ ok: false, error: "Server not configured." }, { status: 500 });

  const token = extractToken(request);
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const svc = makeServiceClient(url, service);
  const [settingRes, brandsRes] = await Promise.all([
    svc.from("app_settings").select("value").eq("key", "lp_global_margin_pct").maybeSingle(),
    svc.from("lp_brand_margins").select("id, brand, margin_pct, updated_at, updated_by").order("brand"),
  ]);

  const globalPct = Number((settingRes.data as { value?: string } | null)?.value ?? "15");
  return Response.json({
    ok: true,
    globalPct: Number.isFinite(globalPct) && globalPct > 0 ? globalPct : 15,
    brandMargins: brandsRes.data ?? [],
  });
}

/** POST — saves global margin or a brand margin */
export async function POST(request: Request): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service)
    return Response.json({ ok: false, error: "Server not configured." }, { status: 500 });

  const token = extractToken(request);
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const authUser = await resolveAndAuthorise(url, anon, service, token);
  if (!authUser) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    type: "global" | "brand";
    pct?: number;
    brand?: string;
  } | null;
  if (!body) return Response.json({ ok: false, error: "Invalid body." }, { status: 400 });

  const svc = makeServiceClient(url, service);
  const now = new Date().toISOString();

  if (body.type === "global") {
    const pct = Number(body.pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100)
      return Response.json({ ok: false, error: "Margin must be between 1 and 99." }, { status: 400 });
    const { error } = await svc
      .from("app_settings")
      .upsert({ key: "lp_global_margin_pct", value: String(pct), updated_by: authUser.id, updated_at: now }, { onConflict: "key" });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  if (body.type === "brand") {
    const brand = (body.brand ?? "").trim();
    const pct = Number(body.pct);
    if (!brand) return Response.json({ ok: false, error: "Brand is required." }, { status: 400 });
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100)
      return Response.json({ ok: false, error: "Margin must be between 1 and 99." }, { status: 400 });
    const { error } = await svc
      .from("lp_brand_margins")
      .upsert({ brand, margin_pct: pct, updated_by: authUser.id, updated_at: now }, { onConflict: "brand" });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Unknown type." }, { status: 400 });
}

/** DELETE — removes a brand margin by id */
export async function DELETE(request: Request): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service)
    return Response.json({ ok: false, error: "Server not configured." }, { status: 500 });

  const token = extractToken(request);
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const authUser = await resolveAndAuthorise(url, anon, service, token);
  if (!authUser) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return Response.json({ ok: false, error: "id is required." }, { status: 400 });

  const svc = makeServiceClient(url, service);
  const { error } = await svc.from("lp_brand_margins").delete().eq("id", body.id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
