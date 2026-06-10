import { createClient } from "@supabase/supabase-js";

import { runPoll } from "@/lib/amazon-ingest/poll";
import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return false;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return false;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  const profile = { id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile;
  return isManager(profile) || profile.id === MARICEL_ID;
}

/**
 * Manager/Maricel-triggered live re-ingest of Amazon emails (no shared secret).
 * Used by the "Sync remittance emails" button so the remittance breakdown
 * populates on demand without a terminal or the cron.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const summary = await runPoll({ dryRun: false, lookbackHours: 120 });
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Re-ingest failed." },
      { status: 500 }
    );
  }
}
