import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUser(request: Request): Promise<{ id: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

function svcClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

/** GET /api/packing/lists — list all packing lists */
export async function GET(request: Request): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc.from("packing_lists" as any) as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, lists: data ?? [] });
}

/** POST /api/packing/lists — create a packing list with its line items */
export async function POST(request: Request): Promise<Response> {
  const user = await getUser(request);
  if (!user) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const body = (await request.json()) as {
    company: string;
    mode: string;
    invoice_no: string | null;
    list_date: string;
    consignee_name: string | null;
    consignee_address: string | null;
    notes: string | null;
    status: string;
    items: Record<string, unknown>[];
  };

  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: list, error: listErr } = await (svc.from("packing_lists" as any) as any)
    .insert({
      company: body.company,
      mode: body.mode,
      invoice_no: body.invoice_no || null,
      list_date: body.list_date,
      consignee_name: body.consignee_name || null,
      consignee_address: body.consignee_address || null,
      notes: body.notes || null,
      status: body.status ?? "draft",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (listErr) return Response.json({ ok: false, error: listErr.message }, { status: 400 });

  if (body.items?.length) {
    const rows = body.items.map((item, idx) => ({
      ...item,
      packing_list_id: list.id,
      sl_no: idx + 1,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: itemsErr } = await (svc.from("packing_list_items" as any) as any).insert(rows);
    if (itemsErr) return Response.json({ ok: false, error: itemsErr.message }, { status: 400 });
  }

  return Response.json({ ok: true, id: list.id }, { status: 201 });
}
