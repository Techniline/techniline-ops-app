import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Maricel — the vendor-ops user allowed to maintain internal PO fields. */
const MARICEL_UID = "227fdb27-80b5-4040-ab14-4bb945068af7";

/** Only these internal columns may be written from the UI — never PO/Amazon data. */
type PoPatch = {
  booking_date?: string | null;
  booking_ref?: string | null;
  internal_status?: string | null;
  internal_note?: string | null;
  invoice_number?: string | null;
};

function cleanPatch(body: unknown): PoPatch {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  return {
    booking_date: str(b.booking_date),
    booking_ref: str(b.booking_ref),
    internal_status: str(b.internal_status),
    internal_note: str(b.internal_note),
    invoice_number: str(b.invoice_number),
  };
}

export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service || !anon) {
    return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: u, error: authErr } = await auth.auth.getUser(token);
  if (authErr || !u.user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", u.user.id).maybeSingle();
  const profile = { id: u.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile;
  const allowed = isManager(profile) || u.user.id === MARICEL_UID;
  if (!allowed) return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { id?: string } & Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return Response.json({ ok: false, error: "Missing PO id." }, { status: 400 });

  const patch = { ...cleanPatch(body), updated_at: new Date().toISOString() };
  const { data, error } = await svc
    .from("vendor_purchase_orders")
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, row: data });
}
