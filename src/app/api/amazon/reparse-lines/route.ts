import { createClient } from "@supabase/supabase-js";

import { fetchBody, fetchMessages } from "@/lib/amazon-ingest/graph";
import { parseEmail } from "@/lib/amazon-ingest/parseEmail";
import { executePlan } from "@/lib/amazon-ingest/upsert";
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
 * Re-fetch remittance emails from Outlook (vihan mailbox only, last 30 days)
 * and re-parse them with the current 9-column HTML parser. Populates
 * vendor_code, transaction_type, invoice_amount_aed, terms_discount_taken_aed.
 *
 * Bypasses runPoll to avoid iterating the secondary mailbox and to cap header
 * pagination — keeps the function well within the 60-second limit.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const mailbox = "vihan@techniline.org";
    const sinceIso = new Date(Date.now() - 720 * 3_600_000).toISOString(); // 30 days

    // Fetch message headers from the last 30 days using $filter (no $search).
    // Default cap of 1000 headers covers even high-traffic inboxes over 30 days.
    const headers = await fetchMessages(mailbox, sinceIso);

    // Client-side: keep only emails whose subject mentions "remittance".
    const remittanceHeaders = headers.filter((m) =>
      (m.subject ?? "").toLowerCase().includes("remittance")
    );

    // Fetch HTML bodies in parallel (at most ~15 emails).
    const withBodies = await Promise.all(
      remittanceHeaders.map(async (msg) => {
        const bodyText = (await fetchBody(mailbox, msg.id)) ?? undefined;
        return { msg, bodyText };
      })
    );

    // Parse all emails first (CPU-only, instant), then upsert all remittances in parallel.
    // Parallelising across remittances is safe — each has a distinct remittance_ref so
    // there are no cross-remittance row conflicts.
    const parsed = withBodies
      .map(({ msg, bodyText }) => ({
        result: parseEmail({
          messageId: msg.internetMessageId ?? msg.id,
          from: msg.fromAddress ?? undefined,
          subject: msg.subject ?? undefined,
          receivedAt: msg.receivedDateTime ?? undefined,
          bodyText,
        }),
      }))
      .filter(({ result }) => result.type === "remittance");

    const upsertResults = await Promise.all(
      parsed.map(async ({ result }) => {
        const executed = await executePlan(result.operations);
        return {
          linesReparsed: result.operations.filter((o) => o.table === "remittance_lines").length,
          writeErrors: executed.filter((o) => o.result === "error").length,
        };
      })
    );

    const linesReparsed = upsertResults.reduce((s, r) => s + r.linesReparsed, 0);
    const writeErrors = upsertResults.reduce((s, r) => s + r.writeErrors, 0);
    const remittancesWritten = upsertResults.length;

    return Response.json({
      ok: true,
      remittances: remittancesWritten,
      linesReparsed,
      writeErrors,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Deep sync failed." },
      { status: 500 }
    );
  }
}
