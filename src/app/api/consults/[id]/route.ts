import { authorizeConsults } from "@/lib/consults/serverAuth";
import type { ConsultBookingPatch, BookingStatus } from "@/lib/consults/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: BookingStatus[] = ["pending", "called", "no_answer", "closed"];

// ── PATCH /api/consults/[id] — update status / call notes (auth required) ──

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await authorizeConsults(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!id) return Response.json({ ok: false, error: "Missing booking id." }, { status: 400 });

  let body: ConsultBookingPatch;
  try {
    body = (await request.json()) as ConsultBookingPatch;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { status, call_notes } = body;
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return Response.json({ ok: false, error: `Invalid status "${status}".` }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: auth.uid,
  };
  if (status !== undefined) patch.status = status;
  if (call_notes !== undefined) patch.call_notes = call_notes;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (auth.serviceClient as any)
    .from("consult_bookings")
    .update(patch)
    .eq("id", id);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
