import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/spapi/sku-costs — read all SKU cost rows via service-role (bypasses RLS). */
export async function GET(request: Request): Promise<Response> {
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
  const { data, error } = await svc.from("seller_sku_costs").select("*").order("seller_sku").range(0, 49999);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, rows: data ?? [] });
}

/** Users allowed to edit SKU costs (beyond managers): Aaron + Kesh (Amazon ops). */
const COST_EDITORS = new Set([
  "cbb81b27-8756-4f2d-bfe0-04211c27092c", // Aaron
  "4f0eaff3-3ce3-44de-8ed9-aa84246fc538", // Kesh
]);

function cleanNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Bulk upsert (import / edit) or delete SKU cost rows. Manager / Aaron / Kesh. */
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
  if (!(isManager(profile) || COST_EDITORS.has(u.user.id))) {
    return Response.json({ ok: false, error: "Forbidden — you can't edit SKU costs." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = clean(body.action) ?? "upsert";

  if (action === "delete") {
    const sku = clean(body.seller_sku);
    if (!sku) return Response.json({ ok: false, error: "Missing seller_sku." }, { status: 400 });
    const { error } = await svc.from("seller_sku_costs").delete().eq("seller_sku", sku);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, count: 1 });
  }

  // upsert (single edit or bulk import)
  const rawRows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
  const nowIso = new Date().toISOString();
  const rows = rawRows
    .map((r) => ({
      seller_sku: clean(r.seller_sku),
      expected_in_hand: cleanNum(r.expected_in_hand),
      cost: cleanNum(r.cost),
      sell_price: cleanNum(r.sell_price),
      notes: clean(r.notes),
      updated_by: u.user.id,
      updated_at: nowIso,
    }))
    .filter((r) => r.seller_sku);
  if (rows.length === 0) return Response.json({ ok: false, error: "No valid rows (each needs a SKU)." }, { status: 400 });

  // De-dupe by SKU within the batch (last wins) so the upsert doesn't error.
  const bySku = new Map<string, (typeof rows)[number]>();
  for (const r of rows) bySku.set(r.seller_sku as string, r);
  const deduped = [...bySku.values()];

  const { data: written, error } = await svc
    .from("seller_sku_costs")
    .upsert(deduped as never, { onConflict: "seller_sku" })
    .select("seller_sku");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const writtenCount = (written as unknown[] | null)?.length ?? 0;
  if (writtenCount === 0) {
    return Response.json({ ok: false, error: `Upsert returned 0 rows written — check if seller_sku_costs has a unique constraint on seller_sku.` }, { status: 500 });
  }
  return Response.json({ ok: true, count: writtenCount });
}
