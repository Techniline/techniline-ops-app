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

  // Fetch the line and compute current availability (with locking via service role)
  const { data: line, error: lineErr } = await svc
    .from("impo_lines")
    .select("id, qty_incoming")
    .eq("id", impo_line_id)
    .single();

  if (lineErr || !line) return Response.json({ ok: false, error: "IMPO line not found." }, { status: 404 });

  const { data: existing } = await svc
    .from("stock_reservations")
    .select("qty_requested")
    .eq("impo_line_id", impo_line_id)
    .in("status", ["pending", "approved"]);

  const totalReserved = (existing ?? []).reduce((s: number, r: { qty_requested: number }) => s + r.qty_requested, 0);
  const available = (line as { qty_incoming: number }).qty_incoming - totalReserved;

  if (qty_requested > available) {
    return Response.json(
      { ok: false, error: `Only ${available} unit(s) available in this IMPO.`, available },
      { status: 409 }
    );
  }

  const { data: res, error: insErr } = await svc
    .from("stock_reservations")
    .insert({
      impo_line_id,
      requested_by: auth.uid,
      qty_requested,
      customer_ref: customer_ref ?? null,
      customer_phone: customer_phone ?? null,
      amount_paid: typeof amount_paid === "number" ? amount_paid : 0,
      payment_method: payment_method ?? null,
      required_by_date: required_by_date ?? null,
      quote_ref: quote_ref ?? null,
      notes: notes ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (insErr || !res) {
    return Response.json({ ok: false, error: insErr?.message ?? "Insert failed." }, { status: 500 });
  }

  return Response.json({ ok: true, id: (res as { id: string }).id });
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
