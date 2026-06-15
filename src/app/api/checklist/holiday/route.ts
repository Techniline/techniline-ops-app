import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function manager(request: Request, url: string, anon: string, service: string): Promise<{ id: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  if (!isManager({ id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile)) return null;
  return { id: data.user.id };
}

function env() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

/** Mark a date as a company holiday + clear that day's open standing tasks. */
export async function POST(request: Request): Promise<Response> {
  const { url, anon, service } = env();
  if (!url || !anon || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  const m = await manager(request, url, anon, service);
  if (!m) return Response.json({ ok: false, error: "Manager only." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { date?: string; label?: string };
  const date = (body.date ?? "").trim();
  if (!DATE_RE.test(date)) return Response.json({ ok: false, error: "Invalid date (YYYY-MM-DD)." }, { status: 400 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await svc
    .from("company_holidays")
    .upsert({ holiday_date: date, label: body.label?.trim() || null, created_by: m.id }, { onConflict: "holiday_date" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Clear already-generated open standing tasks for that day so it reads clean.
  await svc.from("daily_tasks").delete().eq("task_date", date).eq("source", "standing").eq("status", "open");
  return Response.json({ ok: true });
}

/** Remove a company holiday. */
export async function DELETE(request: Request): Promise<Response> {
  const { url, anon, service } = env();
  if (!url || !anon || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  const m = await manager(request, url, anon, service);
  if (!m) return Response.json({ ok: false, error: "Manager only." }, { status: 403 });

  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) return Response.json({ ok: false, error: "Invalid date." }, { status: 400 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await svc.from("company_holidays").delete().eq("holiday_date", date);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
