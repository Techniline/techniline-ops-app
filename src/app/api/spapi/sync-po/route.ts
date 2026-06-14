import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import { fetchVendorPurchaseOrders, spapiConfigured } from "@/lib/spapi/client";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LAST_SYNC_KEY = "vendor_po_last_sync";
const DEFAULT_LOOKBACK_DAYS = 30;

/** Authorize: a manager session OR the cron secret. */
async function authorize(request: Request, svcReady: { url: string; service: string }): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) return false;
  const auth = createClient(svcReady.url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return false;
  const svc = createClient(svcReady.url, svcReady.service, { auth: { persistSession: false } });
  const { data: row } = await svc.from("users").select("role").eq("id", data.user.id).maybeSingle();
  return isManager({ id: data.user.id, role: (row as { role?: string } | null)?.role ?? null } as UserProfile);
}

export async function POST(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });
  if (!(await authorize(request, { url, service }))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!spapiConfigured()) return Response.json({ ok: false, error: "SP-API not configured." }, { status: 500 });

  const svc = createClient(url, service, { auth: { persistSession: false } });

  // Window: from last sync (−1 day overlap) else lookback. PO date can change
  // (state updates), so a small overlap re-captures status changes.
  const { data: setting } = await svc.from("app_settings").select("value").eq("key", LAST_SYNC_KEY).maybeSingle();
  const last = (setting as { value?: string | null } | null)?.value ?? null;
  const createdAfter = last
    ? new Date(new Date(last).getTime() - 24 * 3600 * 1000).toISOString()
    : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const createdBefore = new Date().toISOString();

  let pos;
  try {
    pos = await fetchVendorPurchaseOrders(createdAfter, createdBefore);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Fetch failed." }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  let upserted = 0;
  if (pos.length) {
    const rows = pos.map((p) => ({
      po_number: p.poNumber,
      po_state: p.state,
      po_type: p.type,
      po_date: p.poDate,
      state_changed_at: p.stateChangedAt,
      selling_party: p.sellingParty,
      ship_to_party: p.shipToParty,
      item_count: p.itemCount,
      raw: p.raw as never,
      synced_at: nowIso,
      updated_at: nowIso,
    }));
    const { error } = await svc.from("vendor_purchase_orders").upsert(rows, { onConflict: "po_number" });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    upserted = rows.length;
  }

  await svc.from("app_settings").upsert({ key: LAST_SYNC_KEY, value: nowIso }, { onConflict: "key" });
  return Response.json({ ok: true, fetched: pos.length, upserted, lastSync: nowIso });
}
