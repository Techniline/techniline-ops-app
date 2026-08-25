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

/** Strip everything except letters and digits from a model number. */
function normalizeModelNo(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, "");
}

/** PUT /api/packing/catalog/[id] — update a SKU.
 *  If normalising model_no causes a conflict with an existing record,
 *  we merge the two records (existing wins on non-null fields) and
 *  delete the record being edited, returning the surviving record.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const { id: _id, created_at: _ca, created_by: _cb, source: _src, updated_at: _ua, ...writable } = body;
  void _id; void _ca; void _cb; void _src; void _ua;

  // Normalize model_no
  if (typeof writable.model_no === "string") {
    writable.model_no = normalizeModelNo(writable.model_no);
  }

  const svc = svcClient();

  // Attempt normal update first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
    .update({ ...writable, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  // No conflict — success
  if (!error) return Response.json({ ok: true, item: data });

  // Unique constraint violation on model_no → merge into existing record
  const isUniqueViolation = error.code === "23505" || error.message?.includes("unique");
  if (!isUniqueViolation || typeof writable.model_no !== "string") {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }

  // Find the record that already owns this model_no
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: findErr } = await (svc.from("packing_sku_catalog" as any) as any)
    .select("*")
    .eq("model_no", writable.model_no)
    .single();
  if (findErr || !existing) {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }

  // Fetch the record being edited so we can pull its non-null data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current } = await (svc.from("packing_sku_catalog" as any) as any)
    .select("*")
    .eq("id", id)
    .single();

  // Build a merge patch: fill nulls in the surviving record from the edited record
  const mergePatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const mergeFields = ["description", "hs_code", "country_of_origin", "unit_weight_kg", "unit_cbm", "carton_qty", "carton_weight_kg", "carton_cbm", "notes"];
  // Also apply any changes from the form (writable) if target field is null
  for (const field of mergeFields) {
    const fromForm = writable[field];
    const fromCurrent = current?.[field];
    const inExisting = existing[field];
    if (inExisting == null || inExisting === "") {
      // Prefer the explicitly edited value, fall back to what was on the old record
      const fill = (fromForm != null && fromForm !== "") ? fromForm : fromCurrent;
      if (fill != null && fill !== "") mergePatch[field] = fill;
    } else if (fromForm != null && fromForm !== "") {
      // User explicitly changed this field — apply it
      mergePatch[field] = fromForm;
    }
  }

  // Update the surviving record with merged data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: merged, error: mergeErr } = await (svc.from("packing_sku_catalog" as any) as any)
    .update(mergePatch)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (mergeErr) return Response.json({ ok: false, error: mergeErr.message }, { status: 400 });

  // Delete the now-duplicate record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (svc.from("packing_sku_catalog" as any) as any).delete().eq("id", id);

  return Response.json({ ok: true, item: merged, merged: true });
}

/** DELETE /api/packing/catalog/[id] — remove a SKU */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const svc = svcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc.from("packing_sku_catalog" as any) as any).delete().eq("id", id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
