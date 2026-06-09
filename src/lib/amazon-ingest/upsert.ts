import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database, TablesInsert } from "@/lib/types";

import type { ExecutedOperation, UpsertOperation } from "./types";

let cached: SupabaseClient<Database> | null = null;

/**
 * Server-only Supabase client using the SERVICE ROLE key. Never import this
 * into client code. Created lazily so dry-run (no DB) and the build don't need
 * the secret.
 */
function getServiceClient(): SupabaseClient<Database> {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Server Supabase env not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

type UpsertResult = {
  result: "inserted" | "updated" | "error";
  id: string | null;
  error?: string;
};

/** Manual upsert: look up by natural key, then update or insert.
 *  `preserveOnUpdate` columns are NOT overwritten when a row already exists —
 *  used to protect human/workflow-owned fields (e.g. expected_actions.status)
 *  from being reset by routine re-ingestion of the same email. */
async function upsertRow<K extends keyof Database["public"]["Tables"]>(
  table: K,
  keyColumn: string | null,
  values: Database["public"]["Tables"][K]["Insert"],
  preserveOnUpdate: string[] = []
): Promise<UpsertResult> {
  const sb = getServiceClient();
  const keyVal = keyColumn ? (values as Record<string, unknown>)[keyColumn] : null;

  if (keyColumn && typeof keyVal === "string" && keyVal) {
    const { data: existing, error: selErr } = await sb
      .from(table)
      .select("id")
      .filter(keyColumn, "eq", keyVal)
      .limit(1)
      .maybeSingle();
    if (selErr) return { result: "error", id: null, error: selErr.message };

    if (existing) {
      const id = (existing as unknown as { id: string }).id;
      // Don't clobber human/workflow-owned columns on re-ingest.
      const updateValues: Record<string, unknown> = { ...(values as Record<string, unknown>) };
      for (const col of preserveOnUpdate) delete updateValues[col];
      // `as never` bypasses broken param inference on the generic from(table);
      // `values` is already validated to the table's Insert type by the caller.
      const { error: updErr } = await sb
        .from(table)
        .update(updateValues as never)
        .filter("id", "eq", id);
      if (updErr) return { result: "error", id: null, error: updErr.message };
      return { result: "updated", id };
    }
  }

  const { data: inserted, error: insErr } = await sb
    .from(table)
    .insert(values as never)
    .select("id")
    .maybeSingle();
  if (insErr) return { result: "error", id: null, error: insErr.message };
  return {
    result: "inserted",
    id: (inserted as unknown as { id: string } | null)?.id ?? null,
  };
}

/** Execute a parse plan against the DB (service role). Skips are recorded. */
export async function executePlan(
  operations: UpsertOperation[]
): Promise<ExecutedOperation[]> {
  const out: ExecutedOperation[] = [];

  for (const op of operations) {
    if (op.action === "skip") {
      out.push({
        table: op.table,
        naturalKey: op.naturalKey,
        result: "skipped",
        id: null,
        reason: op.reason,
      });
      continue;
    }

    const keyColumn = op.naturalKey?.column ?? null;
    let r: UpsertResult;
    switch (op.table) {
      case "expected_actions":
        // Preserve workflow/assignment state across re-ingestion — only refresh
        // the email-derived fields, never reset status/assignee.
        r = await upsertRow(
          "expected_actions",
          keyColumn,
          op.values as TablesInsert<"expected_actions">,
          ["status", "assigned_to"]
        );
        break;
      case "disputes":
        r = await upsertRow("disputes", keyColumn, op.values as TablesInsert<"disputes">);
        break;
      case "returns":
        r = await upsertRow("returns", keyColumn, op.values as TablesInsert<"returns">);
        break;
      case "purchase_orders":
        r = await upsertRow("purchase_orders", keyColumn, op.values as TablesInsert<"purchase_orders">);
        break;
      case "remittances":
        r = await upsertRow("remittances", keyColumn, op.values as TablesInsert<"remittances">);
        break;
      case "remittance_lines":
        r = await upsertRow("remittance_lines", keyColumn, op.values as TablesInsert<"remittance_lines">);
        break;
    }

    out.push({
      table: op.table,
      naturalKey: op.naturalKey,
      result: r.result,
      id: r.id,
      error: r.error,
    });
  }

  return out;
}
