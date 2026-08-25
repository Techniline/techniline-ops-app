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

/**
 * POST /api/packing/catalog/normalize-model-nos
 * One-shot cleanup: strips special characters from every model_no in the catalog.
 * Duplicate records that collapse to the same clean model_no are merged
 * (first record with most data survives; others are deleted).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

    const svc = svcClient();

    // Fetch all records paginated
    type Row = { id: string; model_no: string } & Record<string, unknown>;
    const allRows: Row[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (svc.from("packing_sku_catalog" as any) as any)
        .select(`id, model_no, ${DATA_FIELDS.join(", ")}`)
        .order("model_no", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Group rows by their cleaned model_no
    const groups = new Map<string, Row[]>();
    for (const row of allRows) {
      const key = clean(row.model_no);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    let renamed = 0, merged = 0, errors = 0;
    const CONCURRENCY = 20;

    // Collect all jobs
    type Job = { type: "rename"; id: string; newModelNo: string } | { type: "merge"; survivorId: string; patch: Record<string, unknown>; deleteIds: string[] };
    const jobs: Job[] = [];

    for (const [cleanName, rows] of groups) {
      if (rows.length === 1) {
        const row = rows[0];
        if (row.model_no !== cleanName) {
          jobs.push({ type: "rename", id: row.id, newModelNo: cleanName });
        }
        // already clean — skip
      } else {
        // Multiple rows collapse to the same clean name — merge them.
        // Survivor = the one with the most non-null data fields.
        const scored = rows.map((r) => ({
          row: r,
          score: DATA_FIELDS.filter((f) => r[f] != null && r[f] !== "").length,
        }));
        scored.sort((a, b) => b.score - a.score);
        const survivor = scored[0].row;
        const rest = scored.slice(1).map((s) => s.row);

        // Build a merge patch: fill nulls in survivor from the others (in order)
        const patch: Record<string, unknown> = { model_no: cleanName, updated_at: new Date().toISOString() };
        for (const field of DATA_FIELDS) {
          if (survivor[field] == null || survivor[field] === "") {
            for (const other of rest) {
              if (other[field] != null && other[field] !== "") {
                patch[field] = other[field];
                break;
              }
            }
          }
        }

        jobs.push({ type: "merge", survivorId: survivor.id, patch, deleteIds: rest.map((r) => r.id) });
      }
    }

    // Run jobs in batches of CONCURRENCY
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const batch = jobs.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (job) => {
          if (job.type === "rename") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (svc.from("packing_sku_catalog" as any) as any)
              .update({ model_no: job.newModelNo, updated_at: new Date().toISOString() })
              .eq("id", job.id);
            if (error) throw new Error(error.message);
            return "rename";
          } else {
            // Update survivor with merged data
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: uErr } = await (svc.from("packing_sku_catalog" as any) as any)
              .update(job.patch)
              .eq("id", job.survivorId);
            if (uErr) throw new Error(uErr.message);
            // Delete duplicates
            for (const delId of job.deleteIds) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (svc.from("packing_sku_catalog" as any) as any).delete().eq("id", delId);
            }
            return "merge";
          }
        })
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "rejected") { errors++; continue; }
        if (r.value === "rename") renamed++;
        else merged += (batch[j] as Extract<Job, { type: "merge" }>).deleteIds?.length ?? 1;
      }
    }

    return Response.json({ ok: true, total: allRows.length, renamed, merged, errors });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}
