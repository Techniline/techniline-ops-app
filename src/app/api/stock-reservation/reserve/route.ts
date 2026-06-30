import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";

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

  const { impo_line_id, qty_requested, customer_ref, customer_phone, amount_paid, payment_method, required_by_date, quote_ref, notes } = body;
  if (!impo_line_id) return Response.json({ ok: false, error: "impo_line_id required." }, { status: 400 });
  if (!qty_requested || qty_requested < 1) return Response.json({ ok: false, error: "qty_requested must be >= 1." }, { status: 400 });

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

  return Response.json({ ok: true, id: data as string });
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
