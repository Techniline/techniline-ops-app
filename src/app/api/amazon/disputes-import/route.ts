import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { reconcileDisputeReport, type DisputeReportRow } from "@/lib/amazon-actions/importDisputes";
import { hasCapability, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Authorize a manager or finance user by their Supabase session token.
 *  Returns the user id on success, or null. */
async function authorizedUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role, portal_access").eq("id", data.user.id).maybeSingle();
  const profile = {
    id: data.user.id,
    role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null,
    portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;
  return isManager(profile) || hasCapability(profile, "finance") ? data.user.id : null;
}

/**
 * Import a parsed Amazon dispute report: update/create dispute records and close
 * their linked Amazon Actions. The client parses the xlsx/csv and posts the rows;
 * the DB work runs here with the service role so it isn't gated by table RLS.
 */
export async function POST(request: Request): Promise<Response> {
  const userId = await authorizedUserId(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let rows: DisputeReportRow[];
  try {
    const body = (await request.json()) as { rows?: DisputeReportRow[] };
    rows = Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (rows.length === 0) {
    return Response.json({ ok: false, error: "No dispute rows found in the file." }, { status: 400 });
  }
  if (rows.length > 5000) {
    return Response.json({ ok: false, error: "Too many rows (max 5000)." }, { status: 413 });
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    return Response.json({ ok: false, error: "Server not configured." }, { status: 500 });
  }
  const db = createClient<Database>(url, service, { auth: { persistSession: false } });

  try {
    const summary = await reconcileDisputeReport(db, rows, userId);
    return Response.json({ ok: true, summary });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Import failed." },
      { status: 500 }
    );
  }
}
