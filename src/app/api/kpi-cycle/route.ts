import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Set the shared KPI cycle (manager only). Body: { year, quarter }. Stored in
 *  app_settings under key 'kpi_cycle' so every viewer sees the same quarter. */
export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service || !anon) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: u, error } = await auth.auth.getUser(token);
  if (error || !u.user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", u.user.id).maybeSingle();
  if (!isManager({ id: u.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile)) {
    return Response.json({ ok: false, error: "Manager access required to set the cycle." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { year?: number; quarter?: number };
  const year = Number(body.year);
  const quarter = Number(body.quarter);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || ![1, 2, 3, 4].includes(quarter)) {
    return Response.json({ ok: false, error: "Invalid year/quarter." }, { status: 400 });
  }

  const { error: upErr } = await svc.from("app_settings").upsert({ key: "kpi_cycle", value: JSON.stringify({ year, quarter }) }, { onConflict: "key" });
  if (upErr) return Response.json({ ok: false, error: upErr.message }, { status: 500 });
  return Response.json({ ok: true, year, quarter });
}
