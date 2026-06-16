import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Users allowed to edit Amazon return documentation (beyond managers): Maricel
 *  and Kesh. */
const DOC_EDITORS = new Set([
  "227fdb27-80b5-4040-ab14-4bb945068af7", // Maricel
  "4f0eaff3-3ce3-44de-8ed9-aa84246fc538", // Kesh
]);

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cleanNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Upsert the return paperwork for one Amazon order. Maricel or a manager only. */
export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service || !anon) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: u, error: authErr } = await auth.auth.getUser(token);
  if (authErr || !u.user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", u.user.id).maybeSingle();
  const profile = { id: u.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile;
  if (!(isManager(profile) || DOC_EDITORS.has(u.user.id))) {
    return Response.json({ ok: false, error: "Forbidden — you can't edit return documentation." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const amazonOrderId = clean(body.amazon_order_id);
  if (!amazonOrderId) return Response.json({ ok: false, error: "Missing order id." }, { status: 400 });

  const fields = {
    invoice_number: clean(body.invoice_number),
    prt_number: clean(body.prt_number),
    srt_number: clean(body.srt_number),
    return_note: clean(body.return_note),
    doc_status: clean(body.doc_status),
  };
  // Operational delivery fields (not audit-logged — the log table tracks only the
  // return-doc fields above).
  const delivery = {
    delivery_status: clean(body.delivery_status),
    delivery_date: clean(body.delivery_date),
    amazon_return_date: clean(body.amazon_return_date),
    tracking_number: clean(body.tracking_number),
    delivery_charge: cleanNum(body.delivery_charge),
    delivery_address: clean(body.delivery_address),
  };
  const patch = { amazon_order_id: amazonOrderId, ...fields, ...delivery, updated_by: u.user.id, updated_at: new Date().toISOString() };
  const { data, error } = await svc
    .from("seller_order_docs")
    .upsert(patch as never, { onConflict: "amazon_order_id" })
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Append an audit-log entry (who changed what, with their comment + a snapshot).
  await svc.from("seller_order_doc_log").insert({
    amazon_order_id: amazonOrderId,
    changed_by: u.user.id,
    comment: clean(body.comment),
    ...fields,
  } as never);

  return Response.json({ ok: true, row: data });
}
