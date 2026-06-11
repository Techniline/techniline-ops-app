import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** Mark an abandoned cart actioned / dismissed (upsert on checkout_id). */
export async function POST(request: Request): Promise<Response> {
  const uid = await authorizedId(request);
  if (!uid) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const checkoutId = typeof b.checkoutId === "string" ? b.checkoutId.trim() : "";
  const requested = b.status === "dismissed" ? "dismissed" : b.status === "open" ? "open" : "actioned";
  if (!checkoutId) return Response.json({ ok: false, error: "Missing checkout id." }, { status: 400 });

  const outcome = typeof b.outcome === "string" && b.outcome.trim() ? b.outcome.trim() : null;
  const noteVal = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  // Proof requirement: actioning a cart needs an outcome + a note (unless it became a deal).
  if (requested === "actioned" && outcome !== "created_deal" && (!outcome || !noteVal)) {
    return Response.json({ ok: false, error: "Pick an outcome and add a note before clearing the cart." }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  const svc = createClient(url, service, { auth: { persistSession: false } });

  // "open" = undo: remove the action record so the cart is fresh/open again.
  if (requested === "open") {
    const { error } = await svc.from("mm_abandoned_actions").delete().eq("checkout_id", checkoutId);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, reverted: true });
  }

  const status = requested;
  const row = {
    checkout_id: checkoutId,
    action_status: status,
    customer_name: typeof b.customerName === "string" ? b.customerName : null,
    customer_email: typeof b.customerEmail === "string" ? b.customerEmail : null,
    total: typeof b.total === "number" ? b.total : null,
    recovery_url: typeof b.recoveryUrl === "string" ? b.recoveryUrl : null,
    checkout_created_at: typeof b.createdAt === "string" ? b.createdAt : null,
    note: noteVal,
    outcome,
    actioned_by: uid,
    actioned_at: new Date().toISOString(),
  };
  const { error } = await svc.from("mm_abandoned_actions").upsert(row, { onConflict: "checkout_id" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
