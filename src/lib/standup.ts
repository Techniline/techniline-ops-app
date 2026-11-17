import { supabase } from "@/lib/supabaseClient";

export const AARON_ID   = "cbb81b27-8756-4f2d-bfe0-04211c27092c";
export const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

export const STANDUP_USERS: Record<string, { name: string; color: string }> = {
  [AARON_ID]:   { name: "Aaron",   color: "blue"   },
  [MARICEL_ID]: { name: "Maricel", color: "violet" },
};

export type ItemStatus = "done" | "carried" | "pending";

export interface StandupItem {
  id: string;
  text: string;
  detail?: string;
  status: ItemStatus;
  /** If this item was carried from a previous day's log, the source date */
  carriedFrom?: string;
}

export interface StandupLog {
  id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD
  yesterday_items: StandupItem[];
  today_items: StandupItem[];
  blocker_items: StandupItem[];
  created_at: string;
  updated_at: string;
}

const sb = supabase as any; // standup_logs not in generated types until migration is run

/** Fetch a single log for a user+date. Returns null if not found. */
export async function fetchStandupLog(userId: string, date: string): Promise<StandupLog | null> {
  const { data, error } = await sb
    .from("standup_logs")
    .select("*")
    .eq("user_id", userId)
    .eq("log_date", date)
    .maybeSingle();
  if (error) throw error;
  return data as StandupLog | null;
}

/** Upsert a standup log (insert on first save, update on subsequent). */
export async function upsertStandupLog(
  userId: string,
  date: string,
  payload: Pick<StandupLog, "yesterday_items" | "today_items" | "blocker_items">
): Promise<StandupLog> {
  const { data, error } = await sb
    .from("standup_logs")
    .upsert(
      {
        user_id: userId,
        log_date: date,
        ...payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,log_date" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as StandupLog;
}

/** Fetch logs for multiple users on a given date (manager overview). */
export async function fetchStandupsByDate(date: string): Promise<StandupLog[]> {
  const { data, error } = await sb
    .from("standup_logs")
    .select("*")
    .eq("log_date", date)
    .in("user_id", [AARON_ID, MARICEL_ID]);
  if (error) throw error;
  return (data ?? []) as StandupLog[];
}

/** Fetch the previous working-day log to auto-fill "yesterday" items. */
export async function fetchPrevLog(userId: string, date: string): Promise<StandupLog | null> {
  const { data, error } = await sb
    .from("standup_logs")
    .select("*")
    .eq("user_id", userId)
    .lt("log_date", date)
    .order("log_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as StandupLog | null;
}

/** Fetch recent logs for a user (for history view). */
export async function fetchRecentLogs(userId: string, limit = 7): Promise<StandupLog[]> {
  const { data, error } = await sb
    .from("standup_logs")
    .select("*")
    .eq("user_id", userId)
    .order("log_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as StandupLog[];
}

/** Fetch open blockers from the blockers table for a user. */
export async function fetchOpenBlockers(userId: string): Promise<{ id: string; what: string }[]> {
  const { data, error } = await supabase
    .from("blockers")
    .select("id, what")
    .eq("created_by", userId)
    .eq("status", "open")
    .order("ageing_from", { ascending: false })
    .limit(10);
  if (error) return [];
  return (data ?? []) as { id: string; what: string }[];
}

/** Format a YYYY-MM-DD date for display, e.g. "Mon 17 Nov" */
export function fmtDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Today's date in Dubai time (UTC+4), formatted as YYYY-MM-DD */
export function dubaiToday(): string {
  const d = new Date(Date.now() + 4 * 60 * 60_000);
  return d.toISOString().slice(0, 10);
}

/** Build the WhatsApp-formatted export text for a log. */
export function buildWhatsAppText(log: StandupLog, name: string): string {
  const lines: string[] = [
    `🧑‍💼 *${name}'s Standup — ${fmtDate(log.log_date)}*`,
    "",
  ];

  if (log.yesterday_items.length > 0) {
    lines.push("✅ *Yesterday*");
    for (const item of log.yesterday_items) {
      const badge = item.status === "carried" ? " _(carried →)_" : "";
      lines.push(`• ${item.text}${badge}`);
      if (item.detail) lines.push(`  _${item.detail}_`);
    }
    lines.push("");
  }

  if (log.today_items.length > 0) {
    lines.push("📋 *Today*");
    for (const item of log.today_items) {
      lines.push(`• ${item.text}`);
      if (item.detail) lines.push(`  _${item.detail}_`);
    }
    lines.push("");
  }

  if (log.blocker_items.length > 0) {
    lines.push("🚫 *Blockers*");
    for (const item of log.blocker_items) {
      lines.push(`• ${item.text}`);
      if (item.detail) lines.push(`  _${item.detail}_`);
    }
  }

  return lines.join("\n").trim();
}
