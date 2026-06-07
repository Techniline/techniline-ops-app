import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Minimal typed schema for the `ingest_log` dedup table. Declared locally so the
 * poller compiles before the table is added to the generated Database types.
 * (Regenerate types after creating the table to fold it into the main schema.)
 */
interface IngestLogRow {
  message_id: string;
  mailbox: string | null;
  received_at: string | null;
  email_type: string | null;
  processed_at: string | null;
}
interface IngestLogSchema {
  public: {
    Tables: {
      ingest_log: {
        Row: IngestLogRow;
        Insert: {
          message_id: string;
          mailbox?: string | null;
          received_at?: string | null;
          email_type?: string | null;
          processed_at?: string | null;
        };
        Update: Partial<IngestLogRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

let cached: SupabaseClient<IngestLogSchema> | null = null;

function client(): SupabaseClient<IngestLogSchema> {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Server Supabase env not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  cached = createClient<IngestLogSchema>(url, key, {
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
    .insert({
      message_id: args.messageId,
      mailbox: args.mailbox,
      received_at: args.receivedAt,
      email_type: args.emailType,
    } as never);
  if (error) throw new Error(error.message);
}
