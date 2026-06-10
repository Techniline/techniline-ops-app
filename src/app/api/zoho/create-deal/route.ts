import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { createBackToBackDeal, zohoConfigured } from "@/lib/zoho/client";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";

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
  return isManager(profile) || profile.id === AARON_ID ? profile.id : null;
}

/** Create a Back-to-Back Zoho deal for an abandoned cart (dedup by email), then
 *  record the link against the cart's action row. */
export async function POST(request: Request): Promise<Response> {
  const uid = await authorizedId(request);
  if (!uid) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  if (!zohoConfigured()) {
    return Response.json({ ok: false, error: "Zoho is not connected yet." }, { status: 503 });
  }

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const checkoutId = typeof b.checkoutId === "string" ? b.checkoutId.trim() : "";

  const outcome = await createBackToBackDeal({
    customerName: typeof b.customerName === "string" ? b.customerName : null,
    customerEmail: typeof b.customerEmail === "string" ? b.customerEmail : null,
    amount: typeof b.total === "number" ? b.total : null,
    recoveryUrl: typeof b.recoveryUrl === "string" ? b.recoveryUrl : null,
  });

  if (outcome.status === "error") {
    return Response.json({ ok: false, status: "error", error: outcome.message }, { status: 502 });
  }

  // Record the deal against the cart (created or matched duplicate).
  if (checkoutId) {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && service) {
      const svc = createClient(url, service, { auth: { persistSession: false } });
      await svc.from("mm_abandoned_actions").upsert(
        {
          checkout_id: checkoutId,
          action_status: "deal_created",
          zoho_deal_id: outcome.dealId,
          customer_name: typeof b.customerName === "string" ? b.customerName : null,
          customer_email: typeof b.customerEmail === "string" ? b.customerEmail : null,
          total: typeof b.total === "number" ? b.total : null,
          recovery_url: typeof b.recoveryUrl === "string" ? b.recoveryUrl : null,
          checkout_created_at: typeof b.createdAt === "string" ? b.createdAt : null,
          note: outcome.status === "duplicate" ? "Matched existing Zoho deal." : null,
          actioned_by: uid,
          actioned_at: new Date().toISOString(),
        },
        { onConflict: "checkout_id" }
      );
    }
  }

  return Response.json({
    ok: true,
    status: outcome.status,
    dealId: outcome.dealId,
    dealUrl: outcome.dealUrl,
    message: outcome.message,
  });
}
