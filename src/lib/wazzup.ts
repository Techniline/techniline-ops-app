import { supabase } from "@/lib/supabaseClient";

export interface WazzupStats {
  pendingChats: number;
  oldestWaitingMin: number;
  newToday: number;
  repliedPct: number | null;
  repliedTotal: number;
  newestInbound: { name: string | null; at: string | null; answered: boolean } | null;
  pendingNames: string[];
  /** Pending chats with their chat id (for the in-app "mark replied / no reply
   *  needed" popup). */
  pending: { chatId: string; name: string; at: string | null }[];
  /** "wazzup" when the count came from Wazzup's unanswered counter (which
   *  respects "No reply needed" / "Mark as read"), else our computed count. */
  pendingSource: "wazzup" | "computed";
}

/** Wazzup's live unanswered counter (respects the "No reply needed" /
 *  "Mark as read" buttons). null when not configured or unavailable. */
async function fetchWazzupUnanswered(): Promise<number | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    const r = await fetch("/api/wazzup/unanswered", { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; configured?: boolean; count?: number };
    if (j.ok && j.configured && typeof j.count === "number") return j.count;
    return null;
  } catch {
    return null;
  }
}

/** Dashboard stats derived from the synced Wazzup message stream. Fail-soft:
 *  returns zeros if the table/data isn't there yet. */
export async function fetchWazzupStats(): Promise<WazzupStats> {
  const empty: WazzupStats = { pendingChats: 0, oldestWaitingMin: 0, newToday: 0, repliedPct: null, repliedTotal: 0, newestInbound: null, pendingNames: [], pending: [], pendingSource: "computed" };
  try {
    // Pending = inbound messages with no reply yet (any age). Select * + filter
    // in JS so a missing no_reply_needed column (pre-migration) can't break this.
    const { data: pend } = await supabase
      .from("wazzup_messages")
      .select("*")
      .eq("direction", "inbound")
      .is("response_minutes", null)
      .order("message_at", { ascending: true })
      .limit(2000);
    // chat_id -> { name, at } for the oldest waiting message, excluding "no reply needed".
    const chats = new Map<string, { name: string; at: string | null }>();
    let oldest: number | null = null;
    for (const r of pend ?? []) {
      if ((r as { no_reply_needed?: boolean }).no_reply_needed === true) continue;
      const t = r.message_at ? new Date(r.message_at).getTime() : null;
      if (t != null && (oldest == null || t < oldest)) oldest = t;
      if (r.chat_id && !chats.has(r.chat_id)) chats.set(r.chat_id, { name: r.contact_name ?? "Unknown", at: r.message_at });
    }
    const pending = [...chats.entries()].map(([chatId, v]) => ({ chatId, name: v.name, at: v.at }));
    const pendingNames = pending.map((p) => p.name);
    const oldestWaitingMin = oldest != null ? Math.max(0, Math.round((Date.now() - oldest) / 60000)) : 0;

    // Reply-within-15-min KPI over the last 7 days.
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: rep } = await supabase
      .from("wazzup_messages")
      .select("response_minutes")
      .eq("direction", "inbound")
      .not("response_minutes", "is", null)
      .gte("message_at", since)
      .limit(5000);
    const repliedTotal = rep?.length ?? 0;
    const within = (rep ?? []).filter((r) => (r.response_minutes ?? 9999) <= 15).length;
    const repliedPct = repliedTotal ? Math.round((within / repliedTotal) * 100) : null;

    // New chats today (distinct chats with any message today).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: todayRows } = await supabase
      .from("wazzup_messages")
      .select("chat_id")
      .gte("message_at", today.toISOString())
      .limit(2000);
    const newToday = new Set((todayRows ?? []).map((r) => r.chat_id).filter(Boolean) as string[]).size;

    // Newest inbound message (to detect a brand-new chat + show who it's from).
    // Skip "no reply needed" rows so a dismissed chat can't re-trigger the alert.
    const { data: latest } = await supabase
      .from("wazzup_messages")
      .select("*")
      .eq("direction", "inbound")
      .order("message_at", { ascending: false })
      .limit(20);
    const li = (latest ?? []).find((r) => (r as { no_reply_needed?: boolean }).no_reply_needed !== true);
    const newestInbound = li ? { name: li.contact_name, at: li.message_at, answered: li.response_minutes != null } : null;

    // Prefer Wazzup's own unanswered counter for the headline count — it honours
    // the "No reply needed" / "Mark as read" buttons. Keep our computed names as
    // the helper list (trimmed so we never show more names than the live count).
    const live = await fetchWazzupUnanswered();
    if (live != null) {
      return {
        pendingChats: live,
        oldestWaitingMin: live > 0 ? oldestWaitingMin : 0,
        newToday,
        repliedPct,
        repliedTotal,
        newestInbound,
        pendingNames: pendingNames.slice(0, live),
        pending: pending.slice(0, live),
        pendingSource: "wazzup",
      };
    }

    return { pendingChats: pending.length, oldestWaitingMin, newToday, repliedPct, repliedTotal, newestInbound, pendingNames, pending, pendingSource: "computed" };
  } catch {
    return empty;
  }
}

/** Clear a pending chat from the dashboard: "replied" (stamps the reply time) or
 *  "no_reply_needed" (marks it handled without affecting the reply KPI). */
export async function resolveWazzupChat(chatId: string, action: "replied" | "no_reply_needed"): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/wazzup/resolve", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, action }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}
