import { createClient } from "@supabase/supabase-js";

import { runPoll } from "@/lib/amazon-ingest/poll";
import { hasCapability, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const { data: row } = await svc
    .from("users")
    .select("role, portal_access")
    .eq("id", data.user.id)
    .maybeSingle();
  const profile = {
    id: data.user.id,
    role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null,
    portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;
  return isManager(profile) || hasCapability(profile, "finance");
}

/**
 * Re-fetch remittance emails from Outlook for the past 90 days and re-ingest
 * them with the current 9-column parser.  This populates vendor_code,
 * transaction_type, invoice_amount_aed, and terms_discount_taken_aed for all
 * lines that were previously parsed with the old 6-column parser.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const summary = await runPoll({
      dryRun: false,
      lookbackHours: 720, // 30 days — covers recent unreviewed remittances within timeout
      force: true,         // re-process even already-ingested emails
      subjectIncludes: "remittance",
    });
    const lineOps = summary.items
      .filter((i) => i.type === "remittance")
      .reduce((s, i) => s + (i.lineOps ?? 0), 0);
    const writeErrors = summary.items
      .filter((i) => i.type === "remittance")
      .reduce((s, i) => s + (i.opErrors ?? 0), 0);
    return Response.json({
      ok: true,
      remittances: summary.written,
      linesReparsed: lineOps,
      writeErrors,
      errors: summary.errors,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Deep sync failed." },
      { status: 500 }
    );
  }
}
