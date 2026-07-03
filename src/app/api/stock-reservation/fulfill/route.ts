import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import {
  getUserEmailById,
  buildFulfillmentHtml,
  sendStockEmail,
  type ReservationEmailData,
} from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FulfillBody {
  reservation_id: string;
  notes?: string;
}

// ── POST /api/stock-reservation/fulfill — mark an approved reservation as collected ──

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = auth.serviceClient as any;

  let body: FulfillBody;
  try {
    body = await request.json() as FulfillBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { reservation_id, notes } = body;
  if (!reservation_id) return Response.json({ ok: false, error: "reservation_id required." }, { status: 400 });

  // Fetch reservation with full detail
  const { data: res, error: fetchErr } = await svc
    .from("stock_reservations")
    .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
    .eq("id", reservation_id)
    .single();

  if (fetchErr || !res) return Response.json({ ok: false, error: "Reservation not found." }, { status: 404 });

  const reservation = res as Record<string, unknown>;
  if (reservation.status !== "approved") {
    return Response.json(
      { ok: false, error: `Cannot mark as fulfilled — current status is "${reservation.status}".` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  const { error: updateErr } = await svc
    .from("stock_reservations")
    .update({
      status: "fulfilled",
      fulfilled_at: now,
      reviewed_by: auth.uid,
      reviewed_at: now,
      ...(notes ? { grace_notes: notes } : {}),
    })
    .eq("id", reservation_id);

  if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 500 });

  // Send collection confirmation email to salesperson
  try {
    const requesterEmail = await getUserEmailById(auth.serviceClient, reservation.requested_by as string);
    if (requesterEmail) {
      const [approverEmail, approverProfile] = await Promise.all([
        getUserEmailById(auth.serviceClient, auth.uid),
        svc.from("users").select("full_name").eq("id", auth.uid).maybeSingle(),
      ]);
      const approverName = (approverProfile.data as { full_name?: string } | null)?.full_name ?? "Manager";

      const impoLine = (reservation.impo_line as Record<string, unknown> | null) ?? {};
      const impoData = (impoLine.impo as Record<string, unknown> | null) ?? {};
      const requester = reservation.requester as { full_name?: string } | null;

      const emailData: ReservationEmailData = {
        id: reservation_id,
        requesterName: requester?.full_name ?? "Salesperson",
        brand: (impoLine.brand as string | null) ?? null,
        itemCode: (impoLine.item_code as string) ?? "",
        description: (impoLine.description as string | null) ?? null,
        qtyRequested: reservation.qty_requested as number,
        qtyApproved: (reservation.qty_approved as number | null) ?? null,
        customerRef: (reservation.customer_ref as string | null) ?? null,
        customerPhone: (reservation.customer_phone as string | null) ?? null,
        amountPaid: (reservation.amount_paid as number | null) ?? null,
        paymentMethod: (reservation.payment_method as string | null) ?? null,
        requiredByDate: (reservation.required_by_date as string | null) ?? null,
        quoteRef: (reservation.quote_ref as string | null) ?? null,
        notes: (reservation.notes as string | null) ?? null,
        graceNotes: notes ?? null,
        impoNumber: (impoData.impo_number as string) ?? "",
        impoEta: (impoData.eta as string | null) ?? null,
        createdAt: reservation.created_at as string,
      };

      const effectiveQty = emailData.qtyApproved ?? emailData.qtyRequested;
      const subject = `✅ Collection Confirmed — ${emailData.itemCode} × ${effectiveQty}`;
      const html = buildFulfillmentHtml(emailData);

      await sendStockEmail(requesterEmail, subject, html, {
        fromName: approverName,
        fromEmail: approverEmail ?? undefined,
        replyTo: approverEmail ? { address: approverEmail, name: approverName } : undefined,
      });
    }
  } catch (e) {
    console.error("[fulfill] confirmation email failed:", e);
  }

  return Response.json({ ok: true });
}
