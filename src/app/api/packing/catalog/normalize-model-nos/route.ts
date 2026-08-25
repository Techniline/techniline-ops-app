import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function clean(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, "");
}

const DATA_FIELDS = [
  "brand", "description", "hs_code", "country_of_origin",
  "unit_weight_kg", "unit_cbm", "carton_qty", "carton_weight_kg", "carton_cbm", "notes",
] as const;

type Row = { id: string; model_no: string } & Record<string, unknown>;

export async function POST(request: Request): Promise<Response> {
  try {
    if (!(await getUser(request))) {
      return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const svc = svcClient();

    // --- Fetch all records ---
    const allRows: Row[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
        .select(`id, model_no, ${DATA_FIELDS.join(", ")}`)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return Response.json({ ok: false, error: `Fetch error: ${error.message}` }, { status: 500 });
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // --- Group by clean model_no (case-insensitive key for grouping) ---
    // Key: cleanName.toLowerCase() → { cleanName, rows[] }
    const groups = new Map<string, { cleanName: string; rows: Row[] }>();
    for (const row of allRows) {
      const cleanName = clean(row.model_no);
      if (!cleanName) continue;
      const key = cleanName.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { cleanName, rows: [] });
      }
      groups.get(key)!.rows.push(row);
    }

    let renamed = 0, merged = 0, errors = 0;
    const failedIds: string[] = [];

    for (const { cleanName, rows } of groups.values()) {
      if (rows.length === 1) {
        // Single record — rename if it has special chars
        const row = rows[0];
        if (row.model_no === cleanName) continue; // already clean

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (svc.from("packing_sku_catalog" as any) as any)
          .update({ model_no: cleanName, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (error) { errors++; failedIds.push(row.id); }
        else renamed++;

      } else {
        // Multiple records collapse to the same clean name — merge.
        // Survivor: the row that already has the clean model_no, or the one with the most data.
        const exactMatch = rows.find((r) => r.model_no === cleanName);
        const scored = rows
          .map((r) => ({ row: r, score: DATA_FIELDS.filter((f) => r[f] != null && r[f] !== "").length }))
          .sort((a, b) => b.score - a.score);
        const survivor = exactMatch ?? scored[0].row;
        const duplicates = rows.filter((r) => r.id !== survivor.id);

        // Build merge patch for the survivor: fill its null fields from duplicates
        const patch: Record<string, unknown> = {
          model_no: cleanName,
          updated_at: new Date().toISOString(),
        };
        for (const field of DATA_FIELDS) {
          if (survivor[field] == null || survivor[field] === "") {
            for (const dup of duplicates) {
              if (dup[field] != null && dup[field] !== "") {
                patch[field] = dup[field];
                break;
              }
            }
          }
        }

        // Update survivor
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateErr } = await (svc.from("packing_sku_catalog" as any) as any)
          .update(patch)
          .eq("id", survivor.id);
        if (updateErr) {
          errors++;
          failedIds.push(survivor.id);
          continue;
        }

        // Delete each duplicate
        for (const dup of duplicates) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: delErr } = await (svc.from("packing_sku_catalog" as any) as any)
            .delete()
            .eq("id", dup.id);
          if (delErr) {
            // Can't delete — rename to _DUP_ prefix so it's visible but not confused with real data
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (svc.from("packing_sku_catalog" as any) as any)
              .update({ model_no: `_DUP_${cleanName}_${dup.id.slice(0, 6)}`, updated_at: new Date().toISOString() })
              .eq("id", dup.id);
            errors++;
            failedIds.push(dup.id);
          } else {
            merged++;
          }
        }
      }
    }

    return Response.json({
      ok: true,
      total: allRows.length,
      renamed,
      merged,
      errors,
      failedIds: failedIds.slice(0, 20), // first 20 for debugging
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
