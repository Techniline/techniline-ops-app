import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import {
  getManagerProfiles,
  createApproveRejectTokens,
  buildGraceNotificationHtml,
  sendStockEmail,
  type ReservationEmailData,
} from "@/lib/stock-reservation/emailService";

const APP_URL = "https://techniline-ops-app.vercel.app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReserveBody {
  impo_line_id: string;
  qty_requested: number;
  customer_ref?: string;
  customer_phone?: string;
  amount_paid?: number;
  payment_method?: string;
  required_by_date?: string;
  quote_ref?: string;
  notes?: string;
  discount_offered?: number;
}

interface CancelBody {
  reservation_id: string;
}

// ── POST /api/stock-reservation/reserve — create a reservation ────────────────

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = auth.serviceClient;

  let body: ReserveBody;
  try {
    body = await request.json() as ReserveBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { impo_line_id, qty_requested, customer_ref, customer_phone, amount_paid, payment_method, required_by_date, quote_ref, notes, discount_offered } = body;
  if (!impo_line_id) return Response.json({ ok: false, error: "impo_line_id required." }, { status: 400 });
  if (!qty_requested || qty_requested < 1) return Response.json({ ok: false, error: "qty_requested must be >= 1." }, { status: 400 });

  // Block bookings on received IMPOs
  const { data: lineCheck } = await svc
    .from("impo_lines")
    .select("id, impo:impos(status)")
    .eq("id", impo_line_id)
    .single();
  if ((lineCheck as { impo?: { status?: string } } | null)?.impo?.status === "arrived") {
    return Response.json(
      { ok: false, error: "This IMPO has been received. Bookings are closed." },
      { status: 409 }
    );
  }

  // Atomic check-and-insert via Postgres function.
  // The function locks the impo_line row (FOR UPDATE) before reading reservation
  // counts, so concurrent calls for the same line queue up — eliminating the
  // read-then-write race condition that two separate API calls would have.
  const { data, error: rpcErr } = await svc.rpc("create_reservation", {
    p_impo_line_id:    impo_line_id,
    p_requested_by:    auth.uid,
    p_qty_requested:   qty_requested,
    p_customer_ref:    customer_ref    ?? null,
    p_customer_phone:  customer_phone  ?? null,
    p_amount_paid:     typeof amount_paid === "number" ? amount_paid : 0,
    p_payment_method:  payment_method  ?? null,
    p_required_by_date: required_by_date ?? null,
    p_quote_ref:       quote_ref       ?? null,
    p_notes:           notes           ?? null,
    p_discount_offered: typeof discount_offered === "number" ? discount_offered : 0,
  });

  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    // Parse the structured error thrown by the Postgres function
    if (msg.includes("INSUFFICIENT_STOCK:")) {
      const available = parseInt(msg.split(":")[1] ?? "0", 10);
      return Response.json(
        { ok: false, error: `Only ${available} unit(s) available in this IMPO.`, available },
        { status: 409 }
      );
    }
    if (msg.includes("not found")) {
      return Response.json({ ok: false, error: "IMPO line not found." }, { status: 404 });
    }
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }

  const reservationId = data as string;

  await (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svcAny = svc as any;
      const [resRes, profileData, managers] = await Promise.all([
        svcAny
          .from("stock_reservations")
          .select("*, impo_line:impo_lines(*, impo:impos(*))")
          .eq("id", reservationId)
          .single(),
        svcAny.from("users").select("full_name").eq("id", auth.uid).maybeSingle(),
        getManagerProfiles(svc),
      ]);

      if (!resRes.data || !managers.length) return;

      const reservation = resRes.data as Record<string, unknown>;
      const requesterName =
        ((profileData as { data?: { full_name?: string } | null }).data)?.full_name ?? auth.email ?? "Salesperson";
      const impoLine = (reservation.impo_line as Record<string, unknown> | null) ?? {};
      const impo = (impoLine.impo as Record<string, unknown> | null) ?? {};

      const emailData: ReservationEmailData = {
        id: reservationId,
        requesterName,
        brand: (impoLine.brand as string | null) ?? null,
        itemCode: (impoLine.item_code as string) ?? "",
        description: (impoLine.description as string | null) ?? null,
        qtyRequested: reservation.qty_requested as number,
        customerRef: (reservation.customer_ref as string | null) ?? null,
        customerPhone: (reservation.customer_phone as string | null) ?? null,
        amountPaid: (reservation.amount_paid as number | null) ?? null,
        paymentMethod: (reservation.payment_method as string | null) ?? null,
        requiredByDate: (reservation.required_by_date as string | null) ?? null,
        quoteRef: (reservation.quote_ref as string | null) ?? null,
        notes: (reservation.notes as string | null) ?? null,
        discountOffered: (reservation.discount_offered as number | null) ?? null,
        impoNumber: (impo.impo_number as string) ?? "",
        impoEta: (impo.eta as string | null) ?? null,
        createdAt: reservation.created_at as string,
      };

      const base = `${APP_URL}/api/stock-reservation/email-action`;
      const subject = `📦 New Reservation Request — ${emailData.itemCode} × ${emailData.qtyRequested} from ${requesterName}`;

      // Send each manager their own email with unique action tokens tied to their UID
      for (const mgr of managers) {
        try {
          const { approveToken, rejectToken } = await createApproveRejectTokens(svc, reservationId, mgr.uid);
          const html = buildGraceNotificationHtml(emailData, `${base}?token=${approveToken}`, `${base}?token=${rejectToken}`);
          await sendStockEmail(mgr.email, subject, html, {
            fromName: `${requesterName} (via Techniline Ops)`,
            replyTo: auth.email ? { address: auth.email, name: requesterName } : undefined,
          });
        } catch (err) {
          console.error(`[reserve] notification to ${mgr.email} failed:`, err);
        }
      }
    } catch (e) {
      console.error("[reserve] Grace notification failed:", e);
    }
  })();

  return Response.json({ ok: true, id: reservationId });
}

// ── DELETE /api/stock-reservation/reserve — cancel own reservation ────────────

export async function DELETE(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = auth.serviceClient;

  let body: CancelBody;
  try {
    body = await request.json() as CancelBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { reservation_id } = body;
  if (!reservation_id) return Response.json({ ok: false, error: "reservation_id required." }, { status: 400 });

  // Fetch the reservation to verify ownership
  const { data: res, error: fetchErr } = await svc
    .from("stock_reservations")
    .select("id, requested_by, status")
    .eq("id", reservation_id)
    .single();

  if (fetchErr || !res) return Response.json({ ok: false, error: "Reservation not found." }, { status: 404 });

  const reservation = res as { id: string; requested_by: string; status: string };
  if (reservation.requested_by !== auth.uid && !auth.isManager) {
    return Response.json({ ok: false, error: "Cannot cancel another user's reservation." }, { status: 403 });
  }
  if (reservation.status === "approved") {
    return Response.json({ ok: false, error: "Cannot cancel an approved reservation. Contact Grace." }, { status: 409 });
  }
  if (reservation.status === "cancelled" || reservation.status === "rejected") {
    return Response.json({ ok: false, error: "Reservation is already closed." }, { status: 409 });
  }

  const { error: updErr } = await svc
    .from("stock_reservations")
    .update({ status: "cancelled" })
    .eq("id", reservation_id);

  if (updErr) return Response.json({ ok: false, error: updErr.message }, { status: 500 });

  return Response.json({ ok: true });
}
