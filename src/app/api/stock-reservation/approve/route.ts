import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import {
  getUserEmailById,
  buildSalespersonDecisionHtml,
  sendStockEmail,
  type ReservationEmailData,
} from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApproveBody {
  reservation_id: string;
  action: "approve" | "reject";
  qty_approved?: number;   // can differ from qty_requested
  grace_notes?: string;
}

interface PatchBody {
  impo_id: string;
  eta?: string;
  status?: "pending" | "in_transit" | "arrived" | "cancelled";
}

// ── POST /api/stock-reservation/approve — approve or reject (manager only) ───

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = auth.serviceClient;

  let body: ApproveBody;
  try {
    body = await request.json() as ApproveBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { reservation_id, action, qty_approved, grace_notes } = body;
  if (!reservation_id) return Response.json({ ok: false, error: "reservation_id required." }, { status: 400 });
  if (action !== "approve" && action !== "reject") {
    return Response.json({ ok: false, error: "action must be 'approve' or 'reject'." }, { status: 400 });
  }

  // Fetch reservation
  const { data: res, error: fetchErr } = await svc
    .from("stock_reservations")
    .select("id, status, qty_requested, impo_line_id")
    .eq("id", reservation_id)
    .single();

  if (fetchErr || !res) return Response.json({ ok: false, error: "Reservation not found." }, { status: 404 });

  const reservation = res as { id: string; status: string; qty_requested: number; impo_line_id: string };
  if (reservation.status !== "pending") {
    return Response.json({ ok: false, error: `Reservation is already ${reservation.status}.` }, { status: 409 });
  }

  if (action === "approve") {
    const approvedQty = qty_approved ?? reservation.qty_requested;
    if (approvedQty < 1) {
      return Response.json({ ok: false, error: "Approved qty must be at least 1." }, { status: 400 });
    }

    // Verify there is still enough availability for the approved qty
    const { data: line } = await svc
      .from("impo_lines")
      .select("qty_incoming")
      .eq("id", reservation.impo_line_id)
      .single();

    const { data: existing } = await svc
      .from("stock_reservations")
      .select("qty_requested")
      .eq("impo_line_id", reservation.impo_line_id)
      .in("status", ["pending", "approved"])
      .neq("id", reservation_id);

    const alreadyReserved = (existing ?? []).reduce((s: number, r: { qty_requested: number }) => s + r.qty_requested, 0);
    const lineQty = (line as { qty_incoming: number } | null)?.qty_incoming ?? 0;
    const available = lineQty - alreadyReserved;

    if (approvedQty > available) {
      return Response.json(
        { ok: false, error: `Only ${available} unit(s) available; cannot approve ${approvedQty}.`, available },
        { status: 409 }
      );
    }

    const { error: updErr } = await svc
      .from("stock_reservations")
      .update({
        status: "approved",
        qty_approved: approvedQty,
        grace_notes: grace_notes ?? null,
        reviewed_by: auth.uid,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reservation_id);

    if (updErr) return Response.json({ ok: false, error: updErr.message }, { status: 500 });

    after(() => scheduleSalespersonNotification(svc, reservation_id, "approve", approvedQty, grace_notes ?? null));
    return Response.json({ ok: true, qty_approved: approvedQty });
  }

  // action === "reject"
  const { error: updErr } = await svc
    .from("stock_reservations")
    .update({
      status: "rejected",
      grace_notes: grace_notes ?? null,
      reviewed_by: auth.uid,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", reservation_id);

  if (updErr) return Response.json({ ok: false, error: updErr.message }, { status: 500 });

  after(() => scheduleSalespersonNotification(svc, reservation_id, "reject", null, grace_notes ?? null));
  return Response.json({ ok: true });
}

async function scheduleSalespersonNotification(
  svc: SupabaseClient,
  reservationId: string,
  outcome: "approve" | "reject",
  qtyApproved: number | null,
  graceNotes: string | null
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svcAny = svc as any;

    const { data: res } = await svcAny
      .from("stock_reservations")
      .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
      .eq("id", reservationId)
      .single();

    if (!res) return;

    const reservation = res as Record<string, unknown>;
    const requesterEmail = await getUserEmailById(svc, reservation.requested_by as string);
    if (!requesterEmail) return;

    const impoLine = (reservation.impo_line as Record<string, unknown> | null) ?? {};
    const impo = (impoLine.impo as Record<string, unknown> | null) ?? {};
    const requester = reservation.requester as { full_name?: string } | null;
    const qtyRequested = reservation.qty_requested as number;

    const emailData: ReservationEmailData = {
      id: reservationId,
      requesterName: requester?.full_name ?? "Salesperson",
      brand: (impoLine.brand as string | null) ?? null,
      itemCode: (impoLine.item_code as string) ?? "",
      description: (impoLine.description as string | null) ?? null,
      qtyRequested,
      qtyApproved: outcome === "approve" ? (qtyApproved ?? qtyRequested) : null,
      customerRef: (reservation.customer_ref as string | null) ?? null,
      customerPhone: (reservation.customer_phone as string | null) ?? null,
      amountPaid: (reservation.amount_paid as number | null) ?? null,
      paymentMethod: (reservation.payment_method as string | null) ?? null,
      requiredByDate: (reservation.required_by_date as string | null) ?? null,
      quoteRef: (reservation.quote_ref as string | null) ?? null,
      notes: (reservation.notes as string | null) ?? null,
      graceNotes,
      impoNumber: (impo.impo_number as string) ?? "",
      impoEta: (impo.eta as string | null) ?? null,
      createdAt: reservation.created_at as string,
    };

    const finalOutcome: "approved" | "rejected" = outcome === "approve" ? "approved" : "rejected";
    const effectiveQty = emailData.qtyApproved ?? qtyRequested;
    const subject =
      finalOutcome === "approved"
        ? `✅ Reservation Approved — ${emailData.itemCode} × ${effectiveQty}`
        : `❌ Reservation Rejected — ${emailData.itemCode} × ${qtyRequested}`;

    const html = buildSalespersonDecisionHtml(emailData, finalOutcome);
    await sendStockEmail(requesterEmail, subject, html);

    // Mark any pending email tokens as used (Grace acted via dashboard)
    await svcAny
      .from("stock_reservation_email_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("reservation_id", reservationId)
      .is("used_at", null);
  } catch (e) {
    console.error("[approve] salesperson notification failed:", e);
  }
}

// ── PATCH /api/stock-reservation/approve — update IMPO ETA or status (manager only) ──

export async function PATCH(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = auth.serviceClient;

  let body: PatchBody;
  try {
    body = await request.json() as PatchBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { impo_id, eta, status } = body;
  if (!impo_id) return Response.json({ ok: false, error: "impo_id required." }, { status: 400 });
  if (!eta && !status) return Response.json({ ok: false, error: "eta or status required." }, { status: 400 });

  const patch: Record<string, string> = {};
  if (eta) patch.eta = eta;
  if (status) patch.status = status;

  const { error } = await svc.from("impos").update(patch).eq("id", impo_id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
