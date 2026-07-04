import { createClient } from "@supabase/supabase-js";

import {
  getUserEmailById,
  buildSalespersonDecisionHtml,
  sendStockEmail,
  type ReservationEmailData,
} from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPIRE_DAYS = 7;
const AUTO_REJECT_NOTE = "Your reservation was automatically closed after 7 days without a decision. Please resubmit if you still need this stock.";

// ── GET /api/cron/expire-reservations — auto-reject pending reservations > 7 days old ──

export async function GET(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createClient(url, service, { auth: { persistSession: false } }) as any;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXPIRE_DAYS);
  const cutoffStr = cutoff.toISOString();

  // Fetch pending reservations older than the cutoff
  const { data: stale, error: fetchErr } = await svc
    .from("stock_reservations")
    .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
    .eq("status", "pending")
    .lt("created_at", cutoffStr);

  if (fetchErr) return Response.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!stale?.length) return Response.json({ ok: true, expired: 0 });

  const staleReservations = stale as Record<string, unknown>[];
  const ids = staleReservations.map((r) => r.id as string);
  const now = new Date().toISOString();

  // Bulk update to rejected
  await svc
    .from("stock_reservations")
    .update({
      status: "rejected",
      reviewed_at: now,
      grace_notes: AUTO_REJECT_NOTE,
    })
    .in("id", ids)
    .eq("status", "pending"); // extra guard — only reject if still pending

  // Mark any pending email tokens as used
  await svc
    .from("stock_reservation_email_tokens")
    .update({ used_at: now })
    .in("reservation_id", ids)
    .is("used_at", null);

  // Send rejection emails
  let notified = 0;
  await Promise.all(
    staleReservations.map(async (res) => {
      try {
        const requesterEmail = await getUserEmailById(svc, res.requested_by as string);
        if (!requesterEmail) return;

        const impoLine = (res.impo_line as Record<string, unknown> | null) ?? {};
        const impoData = (impoLine.impo as Record<string, unknown> | null) ?? {};
        const requester = res.requester as { full_name?: string } | null;

        const emailData: ReservationEmailData = {
          id: res.id as string,
          requesterName: requester?.full_name ?? "Salesperson",
          brand: (impoLine.brand as string | null) ?? null,
          itemCode: (impoLine.item_code as string) ?? "",
          description: (impoLine.description as string | null) ?? null,
          qtyRequested: res.qty_requested as number,
          customerRef: (res.customer_ref as string | null) ?? null,
          customerPhone: (res.customer_phone as string | null) ?? null,
          amountPaid: (res.amount_paid as number | null) ?? null,
          paymentMethod: (res.payment_method as string | null) ?? null,
          requiredByDate: (res.required_by_date as string | null) ?? null,
          quoteRef: (res.quote_ref as string | null) ?? null,
          notes: (res.notes as string | null) ?? null,
          graceNotes: AUTO_REJECT_NOTE,
          impoNumber: (impoData.impo_number as string) ?? "",
          impoEta: (impoData.eta as string | null) ?? null,
          createdAt: res.created_at as string,
        };

        const subject = `❌ Reservation Expired — ${emailData.itemCode} × ${emailData.qtyRequested}`;
        const html = buildSalespersonDecisionHtml(emailData, "rejected");
        await sendStockEmail(requesterEmail, subject, html, { fromName: "Techniline Ops" });
        notified++;
      } catch (e) {
        console.error("[expire-reservations] email failed:", e);
      }
    })
  );

  return Response.json({ ok: true, expired: ids.length, notified });
}
