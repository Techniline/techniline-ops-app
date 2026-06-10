import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type Blocker = Tables<"blockers"> & {
  // Optional joined owner name (when a manager views everyone's blockers).
  owner_name?: string | null;
};

/** Whole days since the blocker's ageing start (created/raised date). */
export function blockerAgeingDays(b: Pick<Blocker, "ageing_from">): number {
  const start = new Date(b.ageing_from).getTime();
  if (!Number.isFinite(start)) return 0;
  const ms = Date.now() - start;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export type AgeingTone = "safe" | "monitor" | "warning" | "action";

/** Ageing tier for the badge colour (mirrors the LP/Cocoblu tiers). */
export function blockerAgeingTier(days: number): AgeingTone {
  if (days <= 2) return "safe";
  if (days <= 5) return "monitor";
  if (days <= 10) return "warning";
  return "action";
}

/**
 * Fetch blockers. Managers may pass `allUsers` to see everyone's (with owner
 * names); otherwise RLS limits the result to the caller's own rows.
 */
export async function fetchBlockers(opts: {
  includeResolved: boolean;
  allUsers: boolean;
}): Promise<Blocker[]> {
  const sel = opts.allUsers
    ? "*, users:created_by(full_name, email)"
    : "*";
  let q = supabase.from("blockers").select(sel);
  if (!opts.includeResolved) q = q.eq("status", "open");
  q = q.order("ageing_from", { ascending: true }); // oldest first
  const { data, error } = await q;
  if (error) return [];
  return ((data ?? []) as unknown as Array<Tables<"blockers"> & { users?: { full_name: string | null; email: string | null } | null }>).map(
    (r) => ({ ...r, owner_name: r.users?.full_name ?? r.users?.email ?? null })
  );
}

/** Raise a new blocker for the current user (who + when are captured automatically). */
export async function addBlocker(what: string, note: string | null, createdBy: string): Promise<void> {
  const { error } = await supabase
    .from("blockers")
    .insert({ what, note, created_by: createdBy, status: "open" });
  if (error) throw new Error(error.message);
}

/** Resolve a blocker — removes it from the active list (kept in history). */
export async function resolveBlocker(id: string, resolvedBy: string): Promise<void> {
  const { error } = await supabase
    .from("blockers")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reopen a resolved blocker (manager/owner correction). */
export async function reopenBlocker(id: string): Promise<void> {
  const { error } = await supabase
    .from("blockers")
    .update({ status: "open", resolved_at: null, resolved_by: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Count of open blockers + the oldest age (for the manager scorecard). */
export async function fetchOpenBlockerStats(): Promise<{ open: number; oldestDays: number }> {
  const { data, error } = await supabase
    .from("blockers")
    .select("ageing_from")
    .eq("status", "open");
  if (error || !data) return { open: 0, oldestDays: 0 };
  let oldest = 0;
  for (const r of data) oldest = Math.max(oldest, blockerAgeingDays(r));
  return { open: data.length, oldestDays: oldest };
}
