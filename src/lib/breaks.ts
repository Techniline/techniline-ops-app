import { supabase } from "@/lib/supabaseClient";
import { nextWorkingMoment, workingMinutesBetween } from "@/lib/workingHours";

export const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";

export type BreakType = "short" | "lunch";
export type BreakEndedBy = "manual" | "auto";

export interface UserBreak {
  id: string;
  user_id: string;
  type: BreakType;
  started_at: string;
  expected_end_at: string;
  ended_at: string | null;
  ended_by: BreakEndedBy | null;
}

/** Duration in minutes for each break type. */
export const BREAK_DURATION: Record<BreakType, number> = { short: 15, lunch: 60 };

/** Resolve the effective end time of a break (auto-expire if overdue). */
export function breakEffectiveEnd(b: UserBreak): Date {
  if (b.ended_at) return new Date(b.ended_at);
  const exp = new Date(b.expected_end_at);
  return exp < new Date() ? exp : new Date(); // still active
}

/** True if this break is currently active (not yet ended or auto-expired). */
export function breakIsActive(b: UserBreak): boolean {
  if (b.ended_at) return false;
  return new Date(b.expected_end_at) > new Date();
}

/** Returns the break window (start → effective end) for SLA adjustment. */
export function breakWindow(b: UserBreak): { start: Date; end: Date } {
  return {
    start: new Date(b.started_at),
    end: b.ended_at ? new Date(b.ended_at) : new Date(b.expected_end_at),
  };
}

/**
 * Compute SLA-adjusted working response minutes for a chat message.
 *
 * Steps:
 *  1. Convert raw response_minutes back to responded_at timestamp.
 *  2. Find the effective SLA start: nextWorkingMoment(message_at), then push
 *     forward past any break window the message landed in.
 *  3. Count working minutes from that effective start to responded_at.
 *
 * Returns working minutes (lower = better), or null if not yet responded.
 */
export function adjustedResponseMinutes(
  messageAt: string,
  responseMinutes: number | null,
  breaks: UserBreak[]
): number | null {
  if (responseMinutes == null) return null;

  const msgDate = new Date(messageAt);
  const respondedAt = new Date(msgDate.getTime() + responseMinutes * 60_000);

  // SLA clock starts at the next working moment after message arrived
  let slaStart = nextWorkingMoment(msgDate);

  // If the message (or the working-start) falls inside a break, push slaStart
  // to the end of that break instead.
  for (const b of breaks) {
    const win = breakWindow(b);
    if (slaStart >= win.start && slaStart < win.end) {
      slaStart = win.end > slaStart ? win.end : slaStart;
    }
  }

  if (respondedAt <= slaStart) return 0;
  return workingMinutesBetween(slaStart, respondedAt);
}

// ── API helpers (called from UI) ──────────────────────────────────────────────

export async function startBreak(type: BreakType): Promise<UserBreak> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/api/breaks/start", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  const j = await res.json() as { break?: UserBreak; error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.break!;
}

export async function endBreak(id: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/api/breaks/end", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const j = await res.json() as { error?: string };
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
}

export async function fetchCurrentBreak(): Promise<UserBreak | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  const res = await fetch("/api/breaks/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = await res.json() as { break: UserBreak | null };
  return j.break;
}

// user_breaks is not in the Supabase-generated types yet (run RUN-BREAK-SQL.sql first).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** Manager-only: fetch break history for a user within a date range. */
export async function fetchBreakHistory(
  userId: string,
  fromIso: string,
  toIso: string
): Promise<UserBreak[]> {
  const { data } = await sb
    .from("user_breaks")
    .select("*")
    .eq("user_id", userId)
    .gte("started_at", fromIso)
    .lt("started_at", toIso)
    .order("started_at", { ascending: false })
    .limit(500);
  return (data as UserBreak[]) ?? [];
}

/** Alias used by scorecard calculations. */
export const fetchBreaksForRange = fetchBreakHistory;
