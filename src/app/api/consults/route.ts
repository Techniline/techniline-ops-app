import { addWorkingMinutes, nextWorkingMoment } from "@/lib/workingHours";
import { authorizeConsults, makeServiceClient } from "@/lib/consults/serverAuth";
import type { ConsultBookingInsert } from "@/lib/consults/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── GET /api/consults — list all bookings (auth required) ──

export async function GET(request: Request): Promise<Response> {
  const auth = await authorizeConsults(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status"); // optional filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = auth.serviceClient as any;

  let q = svc
    .from("consult_bookings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, bookings: data ?? [] });
}

// ── POST /api/consults — create a booking (public, no auth) ──

interface CreateBody {
  name: string;
  phone: string;
  email?: string;
  preferred_slot?: string;
  notes?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { name, phone, email, preferred_slot, notes } = body;
  if (!name?.trim()) return Response.json({ ok: false, error: "Name is required." }, { status: 400 });
  if (!phone?.trim()) return Response.json({ ok: false, error: "Phone is required." }, { status: 400 });

  const svc = makeServiceClient();
  if (!svc) return Response.json({ ok: false, error: "Server misconfiguration." }, { status: 500 });

  // SLA: 4 working hours from the next working moment of submission
  const now = new Date();
  const slaStart = nextWorkingMoment(now);
  const slaDeadline = addWorkingMinutes(slaStart, 4 * 60);

  const insert: ConsultBookingInsert = {
    name: name.trim(),
    phone: phone.trim(),
    email: email?.trim() || null,
    preferred_slot: preferred_slot || null,
    notes: notes?.trim() || null,
    sla_deadline: slaDeadline.toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc as any)
    .from("consult_bookings")
    .insert(insert)
    .select("id")
    .single();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data.id }, { status: 201 });
}
