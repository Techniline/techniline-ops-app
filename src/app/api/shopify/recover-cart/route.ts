import { createClient } from "@supabase/supabase-js";

import { canViewSellerOrders, isManager } from "@/lib/permissions";
import { shopifyConfigured, validateOrder } from "@/lib/shopify/client";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  const { data: row } = await svc.from("users").select("role, portal_access").eq("id", data.user.id).maybeSingle();
  const profile = { id: data.user.id, role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null, portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null } as UserProfile;
  return isManager(profile) || canViewSellerOrders(profile) ? profile.id : null;
}

/** Log a recovered abandoned cart, validated against Shopify by order number. */
export async function POST(request: Request): Promise<Response> {
  const uid = await authorizedId(request);
  if (!uid) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let body: { orderRef?: unknown; amount?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const orderRef = typeof body.orderRef === "string" ? body.orderRef.trim() : "";
  if (!orderRef) return Response.json({ ok: false, error: "Enter the recovered order number." }, { status: 400 });
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  let amount = typeof body.amount === "number" && Number.isFinite(body.amount) ? body.amount : null;

  const row: Record<string, unknown> = {
    order_ref: orderRef,
    amount,
    note,
    recovered_by: uid,
    validation_status: "pending_validation",
    validation_message: null,
  };

  if (shopifyConfigured()) {
    const v = await validateOrder(orderRef);
    row.validation_status = v.status;
    if (v.status === "valid") {
      row.order_ref = v.orderName;
      if (amount == null && v.amount != null) { amount = v.amount; row.amount = v.amount; }
    } else {
      row.validation_message = v.message;
    }
  } else {
    row.validation_message = "Shopify not configured - logged for later validation.";
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await svc.from("mm_recovered_carts").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, log: data });
}
