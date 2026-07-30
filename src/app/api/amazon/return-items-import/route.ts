import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { hasCapability, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface ReturnImportRow {
  return_id: string;
  vret_number: string | null;
  authorization_id: string | null;
  date_received: string;
  return_type: string;
  tracking_number: string | null;
  po_number: string | null;
  warehouse: string | null;
  total_cost_aed: number;
  qty: number;
  model_sku: string | null;
}

export interface ReturnImportSummary {
  parsed: number;
  created: number;
  updated: number;
  skipped: number;
  deductionsCreated: number;
  errors: string[];
}

async function authorizedUserId(request: Request): Promise<string | null> {
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
  const profile = {
    id: data.user.id,
    role: (row as { role?: string; portal_access?: string[] | null } | null)?.role ?? null,
    portal_access: (row as { role?: string; portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;
  return isManager(profile) || hasCapability(profile, "finance") ? data.user.id : null;
}

export async function POST(request: Request): Promise<Response> {
  const userId = await authorizedUserId(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let rows: ReturnImportRow[];
  try {
    const body = (await request.json()) as { rows?: ReturnImportRow[] };
    rows = Array.isArray(body.rows) ? body.rows : [];
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (rows.length === 0) return Response.json({ ok: false, error: "No rows." }, { status: 400 });
  if (rows.length > 2000) return Response.json({ ok: false, error: "Too many rows (max 2000)." }, { status: 413 });

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server not configured." }, { status: 500 });
  const db = createClient<Database>(url, service, { auth: { persistSession: false } });

  const summary: ReturnImportSummary = { parsed: rows.length, created: 0, updated: 0, skipped: 0, deductionsCreated: 0, errors: [] };

  const returnIds = [...new Set(rows.map((r) => r.return_id))];

  // Fetch existing data in parallel
  const [{ data: existing }, { data: matchingRemittances }, { data: existingDeductions }] = await Promise.all([
    db.from("returns").select("id, return_id, total_cost_aed, model_sku, po_number").in("return_id", returnIds),
    db.from("remittances").select("remittance_ref").in("remittance_ref", returnIds),
    db.from("remittance_deductions").select("remittance_ref").in("remittance_ref", returnIds),
  ]);

  const existingByReturnId = new Map<string, NonNullable<typeof existing>[number]>();
  for (const r of existing ?? []) if (r.return_id) existingByReturnId.set(r.return_id, r);

  const remittanceSet = new Set((matchingRemittances ?? []).map((r) => r.remittance_ref));
  const deductionSet = new Set((existingDeductions ?? []).map((d) => d.remittance_ref));

  for (const row of rows) {
    try {
      const ex = existingByReturnId.get(row.return_id);
      if (ex) {
        const patch: Database["public"]["Tables"]["returns"]["Update"] = {};
        if (!ex.total_cost_aed && row.total_cost_aed) patch.total_cost_aed = row.total_cost_aed;
        if (!ex.model_sku && row.model_sku) patch.model_sku = row.model_sku;
        if (!ex.po_number && row.po_number) patch.po_number = row.po_number;
        if (Object.keys(patch).length > 0) {
          const { error } = await db.from("returns").update(patch).eq("id", ex.id);
          if (error) throw new Error(error.message);
          summary.updated++;
        } else {
          summary.skipped++;
        }
      } else {
        const { error } = await db.from("returns").insert({
          return_id: row.return_id,
          vret_number: row.vret_number ?? undefined,
          authorization_id: row.authorization_id ?? undefined,
          date_received: row.date_received,
          return_type: row.return_type,
          tracking_number: row.tracking_number ?? undefined,
          po_number: row.po_number ?? undefined,
          warehouse: row.warehouse ?? undefined,
          total_cost_aed: row.total_cost_aed,
          qty: row.qty,
          model_sku: row.model_sku ?? undefined,
          source: "amazon_csv",
          status: "open",
          logged_by: userId,
        });
        if (error) throw new Error(error.message);
        summary.created++;
      }

      // If Amazon sent a remittance payment keyed by this Return ID (email was received),
      // and no deduction line exists yet, create one automatically.
      // We do NOT create remittances records here — those come from emails only.
      if (remittanceSet.has(row.return_id) && !deductionSet.has(row.return_id)) {
        const { error: dedErr } = await db.from("remittance_deductions").insert({
          remittance_ref: row.return_id,
          return_id: row.return_id,
          charge_type: row.return_type,
          amount_aed: -(row.total_cost_aed),
          status: "open",
          return_missing: false,
          created_by: userId,
        });
        if (dedErr) summary.errors.push(`deduction for ${row.return_id}: ${dedErr.message}`);
        else { deductionSet.add(row.return_id); summary.deductionsCreated++; }
      }
    } catch (e) {
      summary.errors.push(`${row.return_id}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return Response.json({ ok: true, summary });
}
