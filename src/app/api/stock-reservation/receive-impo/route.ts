import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import {
  getUserEmailById,
  buildSalespersonDecisionHtml,
  buildStockArrivedHtml,
  sendStockEmail,
  type ReservationEmailData,
} from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LineQty { line_id: string; qty_received: number; }

// ── GET — load modal data (manager only) ──────────────────────────────────────
// Returns IMPO lines + their pending/approved reservations for the confirm modal.

export async function GET(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = auth.serviceClient as any;

  const { searchParams } = new URL(request.url);
  const impoId = searchParams.get("impo_id");
  if (!impoId) return Response.json({ ok: false, error: "impo_id required." }, { status: 400 });

  const [impoRes, linesRes] = await Promise.all([
    svc.from("impos").select("*").eq("id", impoId).single(),
    svc.from("impo_lines").select("*").eq("impo_id", impoId).order("item_code"),
  ]);

  if (impoRes.error || !impoRes.data) {
    return Response.json({ ok: false, error: "IMPO not found." }, { status: 404 });
  }
  if (impoRes.data.status === "arrived") {
    return Response.json({ ok: false, error: "IMPO already received." }, { status: 409 });
  }

  const lineIds = ((linesRes.data ?? []) as { id: string }[]).map((l) => l.id);
  const { data: reservations } = lineIds.length
    ? await svc
        .from("stock_reservations")
        .select("id, impo_line_id, requested_by, qty_requested, qty_approved, status, customer_ref, group_id, requester:users!requested_by(full_name)")
        .in("impo_line_id", lineIds)
        .in("status", ["approved", "pending"])
    : { data: [] };

  type ResRow = {
    id: string; impo_line_id: string; requested_by: string;
    qty_requested: number; qty_approved: number | null;
    status: string; customer_ref: string | null; group_id: string | null;
    requester: { full_name?: string } | null;
  };

  const byLine = new Map<string, { approved: ResRow[]; pending: ResRow[] }>();
  for (const r of (reservations ?? []) as ResRow[]) {
    if (!byLine.has(r.impo_line_id)) byLine.set(r.impo_line_id, { approved: [], pending: [] });
    if (r.status === "approved") byLine.get(r.impo_line_id)!.approved.push(r);
    else byLine.get(r.impo_line_id)!.pending.push(r);
  }

  const lines = ((linesRes.data ?? []) as { id: string; item_code: string; brand: string | null; description: string | null; qty_incoming: number; qty_received: number | null }[]).map((l) => {
    const lineRes = byLine.get(l.id) ?? { approved: [], pending: [] };
    const approvedQtyTotal = lineRes.approved.reduce((s, r) => s + (r.qty_approved ?? r.qty_requested), 0);
    return {
      id: l.id,
      item_code: l.item_code,
      brand: l.brand,
      description: l.description,
      qty_incoming: l.qty_incoming,
      qty_received: l.qty_received,
      approved_qty_total: approvedQtyTotal,
      approved: lineRes.approved.map((r) => ({
        id: r.id,
        salesperson_name: r.requester?.full_name ?? "Unknown",
        uid: r.requested_by,
        qty: r.qty_approved ?? r.qty_requested,
        customer_ref: r.customer_ref,
      })),
      pending: lineRes.pending.map((r) => ({
        id: r.id,
        salesperson_name: r.requester?.full_name ?? "Unknown",
        uid: r.requested_by,
        qty: r.qty_requested,
        customer_ref: r.customer_ref,
      })),
    };
  });

  return Response.json({ ok: true, impo: impoRes.data, lines });
}

// ── POST — execute receipt ────────────────────────────────────────────────────
// 1. Record qty_received per line
// 2. Set IMPO status → "arrived"
// 3. Auto-reject all pending reservations + send rejection emails
// 4. Send "stock arrived" emails to approved salespersons

interface ReceiveBody {
  impo_id: string;
  line_quantities: LineQty[];
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = auth.serviceClient as any;

  let body: ReceiveBody;
  try {
    body = await request.json() as ReceiveBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { impo_id, line_quantities } = body;
  if (!impo_id) return Response.json({ ok: false, error: "impo_id required." }, { status: 400 });

  // Verify IMPO
  const { data: impo, error: impoErr } = await svc.from("impos").select("*").eq("id", impo_id).single();
  if (impoErr || !impo) return Response.json({ ok: false, error: "IMPO not found." }, { status: 404 });
  if (impo.status === "arrived") return Response.json({ ok: false, error: "IMPO already received." }, { status: 409 });

  // Update qty_received per line
  for (const lq of line_quantities ?? []) {
    await svc
      .from("impo_lines")
      .update({ qty_received: lq.qty_received })
      .eq("id", lq.line_id)
      .eq("impo_id", impo_id);
  }

  // Mark IMPO as arrived
  await svc.from("impos").update({ status: "arrived" }).eq("id", impo_id);

  // Get all lines for this IMPO
  const { data: impoLines } = await svc.from("impo_lines").select("id").eq("impo_id", impo_id);
  const allLineIds = ((impoLines ?? []) as { id: string }[]).map((l) => l.id);
  if (!allLineIds.length) return Response.json({ ok: true, rejected: 0, notified: 0 });

  // Fetch pending + approved reservations with full detail for emails
  const [pendingRes, approvedRes] = await Promise.all([
    svc
      .from("stock_reservations")
      .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
      .in("impo_line_id", allLineIds)
      .eq("status", "pending"),
    svc
      .from("stock_reservations")
      .select("*, impo_line:impo_lines(*, impo:impos(*)), requester:users!requested_by(full_name)")
      .in("impo_line_id", allLineIds)
      .eq("status", "approved"),
  ]);

  const pending = (pendingRes.data ?? []) as Record<string, unknown>[];
  const approved = (approvedRes.data ?? []) as Record<string, unknown>[];

  // Auto-reject all pending
  if (allLineIds.length > 0) {
    await svc
      .from("stock_reservations")
      .update({
        status: "rejected",
        reviewed_by: auth.uid,
        reviewed_at: new Date().toISOString(),
        grace_notes: "IMPO received — stock has arrived and your reservation was not approved in time.",
      })
      .in("impo_line_id", allLineIds)
      .eq("status", "pending");

    // Mark any pending email tokens for these reservations as used
    const pendingIds = pending.map((r) => r.id as string);
    if (pendingIds.length > 0) {
      await svc
        .from("stock_reservation_email_tokens")
        .update({ used_at: new Date().toISOString() })
        .in("reservation_id", pendingIds)
        .is("used_at", null);
    }
  }

  // Get approver email/name (Grace)
  const [approverEmail, approverProfile] = await Promise.all([
    getUserEmailById(auth.serviceClient, auth.uid),
    svc.from("users").select("full_name").eq("id", auth.uid).maybeSingle(),
  ]);
  const approverName = (approverProfile.data as { full_name?: string } | null)?.full_name ?? "Manager";

  function buildEmailData(res: Record<string, unknown>): ReservationEmailData {
    const impoLine = (res.impo_line as Record<string, unknown> | null) ?? {};
    const impoData = (impoLine.impo as Record<string, unknown> | null) ?? {};
    const requester = res.requester as { full_name?: string } | null;
    return {
      id: res.id as string,
      requesterName: requester?.full_name ?? "Salesperson",
      brand: (impoLine.brand as string | null) ?? null,
      itemCode: (impoLine.item_code as string) ?? "",
      description: (impoLine.description as string | null) ?? null,
      qtyRequested: res.qty_requested as number,
      qtyApproved: (res.qty_approved as number | null) ?? null,
      customerRef: (res.customer_ref as string | null) ?? null,
      customerPhone: (res.customer_phone as string | null) ?? null,
      amountPaid: (res.amount_paid as number | null) ?? null,
      paymentMethod: (res.payment_method as string | null) ?? null,
      requiredByDate: (res.required_by_date as string | null) ?? null,
      quoteRef: (res.quote_ref as string | null) ?? null,
      notes: (res.notes as string | null) ?? null,
      graceNotes: (res.grace_notes as string | null) ?? null,
      impoNumber: (impoData.impo_number as string) ?? "",
      impoEta: (impoData.eta as string | null) ?? null,
      createdAt: res.created_at as string,
    };
  }

  // Send rejection emails to auto-rejected pending reservations
  await Promise.all(
    pending.map(async (res) => {
      try {
        const requesterEmail = await getUserEmailById(auth.serviceClient, res.requested_by as string);
        if (!requesterEmail) return;
        const emailData = buildEmailData(res);
        const subject = `❌ Reservation Closed — ${emailData.itemCode} × ${emailData.qtyRequested} (IMPO Received)`;
        const html = buildSalespersonDecisionHtml(
          { ...emailData, graceNotes: "This IMPO has been received. Your reservation was not approved in time — please reach out if you still need this stock." },
          "rejected"
        );
        await sendStockEmail(requesterEmail, subject, html, {
          fromName: approverName,
          fromEmail: approverEmail ?? undefined,
          replyTo: approverEmail ? { address: approverEmail, name: approverName } : undefined,
        });
      } catch (e) {
        console.error("[receive-impo] rejection email failed:", e);
      }
    })
  );

  // Send "stock arrived" emails to approved salespersons
  await Promise.all(
    approved.map(async (res) => {
      try {
        const requesterEmail = await getUserEmailById(auth.serviceClient, res.requested_by as string);
        if (!requesterEmail) return;
        const emailData = buildEmailData(res);
        const effectiveQty = emailData.qtyApproved ?? emailData.qtyRequested;
        const subject = `📦 Your Stock Has Arrived — ${emailData.itemCode} × ${effectiveQty}`;
        const html = buildStockArrivedHtml(emailData);
        await sendStockEmail(requesterEmail, subject, html, {
          fromName: approverName,
          fromEmail: approverEmail ?? undefined,
          replyTo: approverEmail ? { address: approverEmail, name: approverName } : undefined,
        });
      } catch (e) {
        console.error("[receive-impo] arrived email failed:", e);
      }
    })
  );

  return Response.json({ ok: true, rejected: pending.length, notified: approved.length });
}
