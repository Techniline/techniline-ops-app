import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { buildDealUrl, extractDealId } from "@/lib/zoho/dealId";
import { validateDeal, zohoConfigured } from "@/lib/zoho/client";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

/** Authenticated user id iff they may use the reseller logger (manager or Maricel). */
async function authorizedId(request: Request): Promise<string | null> {
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
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  const profile = { id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile;
  const ok = isManager(profile) || profile.id === MARICEL_ID;
  return ok ? profile.id : null;
}

/**
 * Validate a Zoho deal (by URL or id) and log it. If Zoho OAuth env is missing
 * or the API errors, the deal is still logged (validation_status pending/api_error)
 * so it can be revalidated later — logging is never blocked.
 */
export async function POST(request: Request): Promise<Response> {
  const uid = await authorizedId(request);
  if (!uid) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let body: { dealInput?: unknown; inquiryNote?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const dealInput = typeof body.dealInput === "string" ? body.dealInput : "";
  const inquiryNote = typeof body.inquiryNote === "string" && body.inquiryNote.trim() ? body.inquiryNote.trim() : null;

  const dealId = extractDealId(dealInput);
  if (!dealId) {
    return Response.json({ ok: false, error: "Couldn't find a Zoho deal id in that input." }, { status: 400 });
  }

  const orgId = process.env.ZOHO_ORG_ID ?? "712284897";
  const dealUrl = buildDealUrl(orgId, dealId);

  // Build the row to upsert, validating via Zoho when configured.
  const row: Record<string, unknown> = {
    deal_id: dealId,
    deal_url: dealUrl,
    inquiry_note: inquiryNote,
    logged_by: uid,
    logged_at: new Date().toISOString(),
    validation_status: "pending_validation",
    validation_message: null,
    deal_name: null,
    owner_name: null,
    owner_email: null,
    deal_created_time: null,
    stage: null,
    amount: null,
  };

  if (zohoConfigured()) {
    const result = await validateDeal(dealId);
    row.validation_status = result.status;
    if (result.status === "valid") {
      row.deal_name = result.deal.dealName;
      row.owner_name = result.deal.ownerName;
      row.owner_email = result.deal.ownerEmail;
      row.deal_created_time = result.deal.createdTime;
      row.stage = result.deal.stage;
      row.amount = result.deal.amount;
      const ctx = [result.deal.accountName, result.deal.contactName].filter(Boolean).join(" · ");
      row.validation_message = ctx || null;
    } else {
      row.validation_message = result.message;
    }
  } else {
    row.validation_message = "Zoho not configured — logged for later validation.";
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  }
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await svc
    .from("reseller_deal_logs")
    .upsert(row, { onConflict: "deal_id" })
    .select("*")
    .single();
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true, log: data });
}
