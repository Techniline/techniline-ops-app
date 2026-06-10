import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

let cached: SupabaseClient<Database> | null = null;

function client(): SupabaseClient<Database> {
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

/** True if this email's message id has already been ingested. */
export async function hasProcessedMessage(messageId: string): Promise<boolean> {
  const { data, error } = await client()
    .from("ingest_log")
    .select("message_id")
    .eq("message_id", messageId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/** Record a successfully-ingested message so it is never reprocessed. */
export async function recordProcessedMessage(args: {
  messageId: string;
  mailbox: string;
  receivedAt: string | null;
  emailType: string;
}): Promise<void> {
  const { error } = await client()
    .from("ingest_log")
    .upsert(
      {
        message_id: args.messageId,
        mailbox: args.mailbox,
        received_at: args.receivedAt,
        email_type: args.emailType,
      },
      { onConflict: "message_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

/**
 * Bulk dedup: given candidate message ids, return the set already in ingest_log.
 * One query instead of one-per-message, so a wide backfill stays under the
 * serverless time limit.
 */
export async function alreadyProcessed(
  messageIds: string[]
): Promise<Set<string>> {
  const seen = new Set<string>();
  if (messageIds.length === 0) return seen;
  // Chunk the IN list to keep URLs/queries reasonable.
  const CHUNK = 200;
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const batch = messageIds.slice(i, i + CHUNK);
    const { data, error } = await client()
      .from("ingest_log")
      .select("message_id")
      .in("message_id", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) seen.add(row.message_id);
  }
  return seen;
}

/** Batch-record processed messages (one insert for the whole run). */
export async function recordProcessedMessages(
  rows: Array<{
    messageId: string;
    mailbox: string;
    receivedAt: string | null;
    emailType: string;
  }>
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client()
    .from("ingest_log")
    .upsert(
      rows.map((r) => ({
        message_id: r.messageId,
        mailbox: r.mailbox,
        received_at: r.receivedAt,
        email_type: r.emailType,
      })),
      { onConflict: "message_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}
