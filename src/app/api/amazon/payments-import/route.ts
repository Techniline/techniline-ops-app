import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { hasCapability, isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface PaymentImportPayment {
  paymentNumber: string;
  paymentDate: string | null;
  netPaidAed: number | null;
  lines: []; // always empty — Payments xlsx has no invoice-level breakdown
}

export interface PaymentImportSummary {
  paymentsCreated: number;
  paymentsUpdated: number;
  linesCreated: number;
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

  let payments: PaymentImportPayment[];
  try {
    const body = (await request.json()) as { payments?: PaymentImportPayment[] };
    payments = Array.isArray(body.payments) ? body.payments : [];
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (payments.length === 0) return Response.json({ ok: false, error: "No payments." }, { status: 400 });
  if (payments.length > 500) return Response.json({ ok: false, error: "Too many payments (max 500)." }, { status: 413 });

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server not configured." }, { status: 500 });
  const db = createClient<Database>(url, service, { auth: { persistSession: false } });

  const summary: PaymentImportSummary = {
    paymentsCreated: 0, paymentsUpdated: 0, linesCreated: 0, deductionsCreated: 0, errors: [],
  };

  const paymentRefs = payments.map((p) => p.paymentNumber);

  const { data: existing } = await db
    .from("remittances")
    .select("remittance_ref, net_paid_aed, payment_date")
    .in("remittance_ref", paymentRefs);

  const existingMap = new Map(
    (existing ?? []).map((r) => [r.remittance_ref, r])
  );

  for (const payment of payments) {
    try {
      const ex = existingMap.get(payment.paymentNumber);
      if (ex) {
        // Only fill blanks — never overwrite email-parsed data
        const patch: Database["public"]["Tables"]["remittances"]["Update"] = {};
        if (!ex.net_paid_aed && payment.netPaidAed != null) patch.net_paid_aed = payment.netPaidAed;
        if (!ex.payment_date && payment.paymentDate) patch.payment_date = payment.paymentDate;
        if (Object.keys(patch).length > 0) {
          await db.from("remittances").update(patch).eq("remittance_ref", payment.paymentNumber);
        }
        summary.paymentsUpdated++;
      } else {
        const { error } = await db.from("remittances").insert({
          remittance_ref: payment.paymentNumber,
          payment_date: payment.paymentDate ?? null,
          net_paid_aed: payment.netPaidAed ?? null,
        });
        if (error) throw new Error(error.message);
        summary.paymentsCreated++;
      }
    } catch (e) {
      summary.errors.push(`${payment.paymentNumber}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return Response.json({ ok: true, summary });
}
