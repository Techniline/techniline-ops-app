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

/** GET /api/packing/lists/[id] — fetch header + items */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const svc = svcClient();

  const [listRes, itemsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from("packing_lists" as any) as any).select("*").eq("id", id).single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from("packing_list_items" as any) as any)
      .select("*")
      .eq("packing_list_id", id)
      .order("sl_no", { ascending: true }),
  ]);

  if (listRes.error) return Response.json({ ok: false, error: listRes.error.message }, { status: 404 });
  return Response.json({ ok: true, list: listRes.data, items: itemsRes.data ?? [] });
}

/** PUT /api/packing/lists/[id] — replace header + items */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as {
    company?: string;
    mode?: string;
    invoice_no?: string | null;
    list_date?: string;
    consignee_name?: string | null;
    consignee_address?: string | null;
    notes?: string | null;
    status?: string;
    shipping_label?: string | null;
    items?: Record<string, unknown>[];
  };

  const svc = svcClient();
  const { company, mode, invoice_no, list_date, consignee_name, consignee_address, notes, status, shipping_label, items } = body;

  // Verify the packing list exists before updating — Supabase UPDATE silently matches 0 rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (svc.from("packing_lists" as any) as any).select("id").eq("id", id).maybeSingle();
  if (!existing) return Response.json({ ok: false, error: "Packing list not found — it may have been deleted." }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (svc.from("packing_lists" as any) as any)
    .update({ company, mode, invoice_no, list_date, consignee_name, consignee_address, notes, status, shipping_label: shipping_label ?? null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 400 });

  if (items !== undefined) {
    // Replace all items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (svc.from("packing_list_items" as any) as any).delete().eq("packing_list_id", id);
    if (items.length > 0) {
      const rows = items.map((item, idx) => ({ ...item, packing_list_id: id, sl_no: idx + 1 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: itemsErr } = await (svc.from("packing_list_items" as any) as any).insert(rows);
      if (itemsErr) return Response.json({ ok: false, error: itemsErr.message }, { status: 400 });
    }
  }

  return Response.json({ ok: true });
}

/** DELETE /api/packing/lists/[id] */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc.from("packing_lists" as any) as any).delete().eq("id", id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
