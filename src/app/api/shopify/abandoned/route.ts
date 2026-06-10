import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { abandonedWindow } from "@/lib/musicmajlis";
import { fetchAbandonedCheckouts, shopifyConfigured } from "@/lib/shopify/client";
import { buildDealUrl } from "@/lib/zoho/dealId";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";
const ORG_ID = process.env.ZOHO_ORG_ID || "712284897";

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
  return isManager(profile) || profile.id === AARON_ID;
}

/** Abandoned carts for the previous-working-day window, merged with Aaron's actions. */
export async function GET(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!shopifyConfigured()) {
    return Response.json({ ok: true, configured: false, windowLabel: null, carts: [], openCount: 0 });
  }
  const win = abandonedWindow();
  if (!win) {
    // Sunday — non-working day, show nothing.
    return Response.json({ ok: true, configured: true, windowLabel: null, carts: [], openCount: 0 });
  }

  let raw;
  try {
    raw = await fetchAbandonedCheckouts(win.fromIso, win.toIso);
  } catch (e) {
    return Response.json(
      { ok: false, configured: true, error: e instanceof Error ? e.message : "Shopify request failed." },
      { status: 502 }
    );
  }

  // Merge stored actions.
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const svc = createClient(url!, service!, { auth: { persistSession: false } });
  const ids = raw.map((c) => c.id);
  const { data: actions } = await svc
    .from("mm_abandoned_actions")
    .select("checkout_id, action_status, zoho_deal_id, note")
    .in("checkout_id", ids.length ? ids : ["__none__"]);
  const byId = new Map(
    (actions ?? []).map((a) => [
      a.checkout_id as string,
      a as { action_status: string; zoho_deal_id: string | null; note: string | null },
    ])
  );

  const carts = raw.map((c) => {
    const a = byId.get(c.id);
    const dealId = a?.zoho_deal_id ?? null;
    return {
      ...c,
      actionStatus: (a?.action_status as string | undefined) ?? "open",
      zohoDealId: dealId,
      zohoDealUrl: dealId ? buildDealUrl(ORG_ID, dealId) : null,
      note: a?.note ?? null,
    };
  });
  const openCount = carts.filter((c) => c.actionStatus === "open").length;

  return Response.json({ ok: true, configured: true, windowLabel: win.label, carts, openCount });
}
