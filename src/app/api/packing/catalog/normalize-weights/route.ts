import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

type Row = {
  id: string;
  model_no: string;
  unit_weight_kg: number | null;
  carton_weight_kg: number | null;
  carton_qty: number | null;
};

/**
 * POST /api/packing/catalog/normalize-weights
 *
 * Fixes SKUs where unit_weight_kg was incorrectly set to the carton gross weight
 * (rather than the per-unit weight). The invariant "unit weight < carton weight"
 * must always hold — when violated, derive the correct unit weight from:
 *   unit_weight_kg = carton_weight_kg / carton_qty
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!(await getUser(request))) {
      return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const svc = svcClient();

    // Fetch all SKUs with weight data
    const allRows: Row[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
        .select("id, model_no, unit_weight_kg, carton_weight_kg, carton_qty")
        .not("carton_weight_kg", "is", null)
        .gt("carton_qty", 0)
        .order("model_no", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return Response.json({ ok: false, error: `Fetch error: ${error.message}` }, { status: 500 });
      if (!data || data.length === 0) break;
      allRows.push(...(data as Row[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Find SKUs where unit_weight_kg >= carton_weight_kg (physically impossible — must be a data error)
    const toFix = allRows.filter(
      (r) => r.unit_weight_kg != null && r.carton_weight_kg != null && r.carton_qty != null
        && r.carton_qty > 0 && r.unit_weight_kg >= r.carton_weight_kg
    );

    let fixed = 0;
    let errors = 0;
    const fixedModels: string[] = [];

    for (const row of toFix) {
      const correctedUnitWeight = Math.round((row.carton_weight_kg! / row.carton_qty!) * 100) / 100;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (svc.from("packing_sku_catalog" as any) as any)
        .update({ unit_weight_kg: correctedUnitWeight, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) {
        errors++;
      } else {
        fixed++;
        if (fixedModels.length < 30) fixedModels.push(`${row.model_no}: ${row.unit_weight_kg} → ${correctedUnitWeight}`);
      }
    }

    return Response.json({
      ok: true,
      scanned: allRows.length,
      fixed,
      errors,
      examples: fixedModels,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
