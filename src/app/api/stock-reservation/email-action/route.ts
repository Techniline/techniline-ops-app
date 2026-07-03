import { createClient } from "@supabase/supabase-js";
import {
  GRACE_UID,
  getUserEmailById,
  buildSalespersonDecisionHtml,
  sendStockEmail,
  type ReservationEmailData,
} from "@/lib/stock-reservation/emailService";
// GRACE_UID used as fallback when token has no reviewer_uid (legacy tokens)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeSvc() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false } });
}

function htmlPage(title: string, emoji: string, heading: string, body: string, color: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Techniline</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#fff;border-radius:20px;padding:52px 44px;max-width:460px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.09);text-align:center}.brand{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:22px}.icon{font-size:54px;line-height:1;margin-bottom:16px}h1{font-size:22px;font-weight:800;color:${color};margin-bottom:10px}p{font-size:14px;color:#64748b;line-height:1.65}.hint{margin-top:22px!important;font-size:12px;color:#94a3b8}</style></head><body><div class="card"><p class="brand">Techniline Ops</p><div class="icon">${emoji}</div><h1>${heading}</h1><p>${body}</p><p class="hint">You can close this tab.</p></div></body></html>`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(
      htmlPage("Invalid Link", "&#9888;&#65039;", "Invalid Link", "This action link is missing a token.", "#dc2626"),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const svc = makeSvc();
  if (!svc) {
    return new Response(
      htmlPage("Server Error", "&#9888;&#65039;", "Server Error", "The server is not configured correctly.", "#dc2626"),
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tokenRow, error: tokenErr } = await (svc as any)
    .from("stock_reservation_email_tokens")
    .select("id, reservation_id, action, expires_at, used_at, reviewer_uid")
    .eq("id", token)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return new Response(
      htmlPage("Link Not Found", "&#10067;", "Link Not Found", "This action link is invalid or has expired.", "#dc2626"),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const t = tokenRow as {
    id: string;
    reservation_id: string;
    action: "approve" | "reject";
    expires_at: string;
    used_at: string | null;
    reviewer_uid: string | null;
  };

  if (t.used_at) {
    return new Response(
      htmlPage("Already Done", "&#9989;", "Already Done", "This action has already been taken. The salesperson has been notified.", "#6366f1"),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  if (new Date(t.expires_at) < new Date()) {
    return new Response(
      htmlPage("Link Expired", "&#9200;", "Link Expired", "This action link has expired (72 hours). Please use the Manager Dashboard to review this reservation.", "#f59e0b"),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: res, error: resErr } = await (svc as any)
    .from("stock_reservations")
    .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
    .eq("id", t.reservation_id)
    .single();

  if (resErr || !res) {
    return new Response(
      htmlPage("Not Found", "&#10067;", "Reservation Not Found", "The reservation could not be found.", "#dc2626"),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const reservation = res as Record<string, unknown>;

  if (reservation.status !== "pending") {
    const s = reservation.status as string;
    const desc =
      s === "approved" ? "already been approved" : s === "rejected" ? "already been rejected" : "been closed";
    return new Response(
      htmlPage("Already Processed", "&#9989;", "Already Processed", `This reservation has ${desc}. No further action needed.`, "#6366f1"),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  const action = t.action;
  const reviewerUid = t.reviewer_uid ?? GRACE_UID;
  const updatePayload: Record<string, unknown> = {
    status: action === "approve" ? "approved" : "rejected",
    reviewed_by: reviewerUid,
    reviewed_at: new Date().toISOString(),
  };
  if (action === "approve") {
    updatePayload.qty_approved = reservation.qty_requested;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (svc as any)
    .from("stock_reservations")
    .update(updatePayload)
    .eq("id", t.reservation_id)
    .eq("status", "pending");

  if (updErr) {
    return new Response(
      htmlPage("Error", "&#9888;&#65039;", "Action Failed", `Could not ${action} the reservation. Please use the Manager Dashboard.`, "#dc2626"),
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  // Mark both tokens for this reservation used
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (svc as any)
    .from("stock_reservation_email_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("reservation_id", t.reservation_id)
    .is("used_at", null);

  // Notify the salesperson (fire and forget)
  void (async () => {
    try {
      const impoLine = (reservation.impo_line as Record<string, unknown> | null) ?? {};
      const impo = (impoLine.impo as Record<string, unknown> | null) ?? {};
      const requester = reservation.requester as { full_name?: string } | null;

      const [requesterEmail, approverEmail, approverProfile] = await Promise.all([
        getUserEmailById(svc, reservation.requested_by as string),
        getUserEmailById(svc, reviewerUid),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (svc as any).from("users").select("full_name").eq("id", reviewerUid).maybeSingle(),
      ]);
      if (!requesterEmail) return;
      const approverName = (approverProfile.data as { full_name?: string } | null)?.full_name ?? "Manager";

      const qtyRequested = reservation.qty_requested as number;
      const qtyApproved = action === "approve" ? qtyRequested : null;

      const emailData: ReservationEmailData = {
        id: reservation.id as string,
        requesterName: requester?.full_name ?? "Salesperson",
        brand: (impoLine.brand as string | null) ?? null,
        itemCode: (impoLine.item_code as string) ?? "",
        description: (impoLine.description as string | null) ?? null,
        qtyRequested,
        qtyApproved,
        customerRef: (reservation.customer_ref as string | null) ?? null,
        customerPhone: (reservation.customer_phone as string | null) ?? null,
        amountPaid: (reservation.amount_paid as number | null) ?? null,
        paymentMethod: (reservation.payment_method as string | null) ?? null,
        requiredByDate: (reservation.required_by_date as string | null) ?? null,
        quoteRef: (reservation.quote_ref as string | null) ?? null,
        notes: (reservation.notes as string | null) ?? null,
        graceNotes: null,
        impoNumber: (impo.impo_number as string) ?? "",
        impoEta: (impo.eta as string | null) ?? null,
        createdAt: reservation.created_at as string,
      };

      const outcome: "approved" | "rejected" = action === "approve" ? "approved" : "rejected";
      const subject =
        outcome === "approved"
          ? `✅ Reservation Approved — ${emailData.itemCode} × ${qtyApproved ?? qtyRequested}`
          : `❌ Reservation Rejected — ${emailData.itemCode} × ${qtyRequested}`;

      const html = buildSalespersonDecisionHtml(emailData, outcome);
      await sendStockEmail(requesterEmail, subject, html, {
        fromName: approverName,
        replyTo: approverEmail ? { address: approverEmail, name: approverName } : undefined,
        bcc: approverEmail ?? undefined,
      });
    } catch (e) {
      console.error("[email-action] salesperson notification failed:", e);
    }
  })();

  const isApproved = action === "approve";
  return new Response(
    htmlPage(
      isApproved ? "Approved" : "Rejected",
      isApproved ? "&#9989;" : "&#10060;",
      isApproved ? "Reservation Approved" : "Reservation Rejected",
      isApproved
        ? "The reservation has been approved. The salesperson has been notified by email."
        : "The reservation has been rejected. The salesperson has been notified by email.",
      isApproved ? "#059669" : "#dc2626"
    ),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
