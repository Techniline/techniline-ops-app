import { supabase } from "@/lib/supabaseClient";

export interface WazzupStats {
  pendingChats: number;
  oldestWaitingMin: number;
  newToday: number;
  repliedPct: number | null;
  repliedTotal: number;
  newestInbound: { name: string | null; at: string | null; answered: boolean } | null;
  pendingNames: string[];
}

/** Dashboard stats derived from the synced Wazzup message stream. Fail-soft:
 *  returns zeros if the table/data isn't there yet. */
export async function fetchWazzupStats(): Promise<WazzupStats> {
  const empty: WazzupStats = { pendingChats: 0, oldestWaitingMin: 0, newToday: 0, repliedPct: null, repliedTotal: 0, newestInbound: null, pendingNames: [] };
  try {
    // Pending = inbound messages with no reply yet (any age).
    const { data: pend } = await supabase
      .from("wazzup_messages")
      .select("chat_id, message_at, contact_name")
      .eq("direction", "inbound")
      .is("response_minutes", null)
      .order("message_at", { ascending: true })
      .limit(2000);
    const chatNames = new Map<string, string>(); // chat_id -> contact name (oldest-waiting first)
    let oldest: number | null = null;
    for (const r of pend ?? []) {
      const t = r.message_at ? new Date(r.message_at).getTime() : null;
      if (t != null && (oldest == null || t < oldest)) oldest = t;
      if (r.chat_id && !chatNames.has(r.chat_id)) chatNames.set(r.chat_id, r.contact_name ?? "Unknown");
    }
    const pendingNames = [...chatNames.values()];
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
    const { data: latest } = await supabase
      .from("wazzup_messages")
      .select("contact_name, message_at, response_minutes")
      .eq("direction", "inbound")
      .order("message_at", { ascending: false })
      .limit(1);
    const li = latest?.[0];
    const newestInbound = li ? { name: li.contact_name, at: li.message_at, answered: li.response_minutes != null } : null;

    return { pendingChats: chatNames.size, oldestWaitingMin, newToday, repliedPct, repliedTotal, newestInbound, pendingNames };
  } catch {
    return empty;
  }
}
