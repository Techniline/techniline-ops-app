import { hasCapability, isManager } from "@/lib/permissions";
import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert, TablesUpdate, UserProfile } from "@/lib/types";

/** A priority row (includes the `priority_level` + `notes` columns). */
export type Priority = Tables<"priorities">;

export type PriorityLevel = "P1" | "P2" | "P3";
export type PriorityStatus = "open" | "in_progress" | "completed";
/** What the UI shows (overdue is derived, never stored). */
export type PriorityDisplayStatus = PriorityStatus | "overdue";

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
}

export interface CreatePriorityInput {
  createdBy: string;
  title: string;
  description: string | null;
  assignedTo: string | null; // a user id, or null when assignedToBoth
  assignedToBoth: boolean;
  dueDate: string; // YYYY-MM-DD
  priorityLevel: PriorityLevel;
  notes: string | null;
}

export interface UpdatePriorityPatch {
  progressPct?: number;
  status?: PriorityStatus;
  notes?: string | null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Derived display status: completed → overdue (past due, not done) → stored. */
export function priorityDisplayStatus(p: Priority): PriorityDisplayStatus {
  if (p.completed_at || p.status === "completed") return "completed";
  const due = p.due_date_revised ?? p.due_date;
  if (due && due < todayIso()) return "overdue";
  if (p.status === "in_progress" || (p.progress_pct ?? 0) > 0) return "in_progress";
  return "open";
}

/**
 * Fetch priorities the profile may see. RLS is the gate; we also scope the
 * query for non-managers. Fail-soft: [] on error.
 */
export async function fetchPriorities(profile: UserProfile): Promise<Priority[]> {
  let query = supabase.from("priorities").select("*");
  if (!isManager(profile)) {
    query = query.or(
      `assigned_to.eq.${profile.id},assigned_to_both.is.true,created_by.eq.${profile.id}`
    );
  }
  const { data, error } = await query.order("due_date", { ascending: true });
  if (error) return [];
  return data ?? [];
}

/** Create a priority; returns the created row (for the email notification). */
export async function createPriority(input: CreatePriorityInput): Promise<Priority> {
  const payload: TablesInsert<"priorities"> = {
    created_by: input.createdBy,
    title: input.title,
    description: input.description,
    assigned_to: input.assignedToBoth ? null : input.assignedTo,
    assigned_to_both: input.assignedToBoth,
    start_date: todayIso(),
    due_date: input.dueDate,
    priority_level: input.priorityLevel,
    notes: input.notes,
    status: "open",
    progress_pct: 0,
  };
  const { data, error } = await supabase
    .from("priorities")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Update progress / status / notes. Completing sets completed_at + 100%. */
export async function updatePriority(id: string, patch: UpdatePriorityPatch): Promise<void> {
  const payload: TablesUpdate<"priorities"> = {};
  if (patch.progressPct !== undefined) payload.progress_pct = Math.round(patch.progressPct);
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.status !== undefined) {
    payload.status = patch.status;
    if (patch.status === "completed") {
      payload.completed_at = new Date().toISOString();
      payload.progress_pct = 100;
    } else if (patch.status === "in_progress" && (patch.progressPct ?? 0) === 0) {
      // leave progress as-is
    }
  }
  const { data, error } = await supabase
    .from("priorities")
    .update(payload)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Update affected no rows.");
}

/** Checklist-capable, non-manager users — the valid assignees (Aaron, Maricel).
 *  Fail-soft: [] on error. */
export async function fetchAssignableUsers(): Promise<AssignableUser[]> {
  const { data, error } = await supabase.from("users").select("id, full_name, email, role");
  if (error) return [];
  return (data ?? [])
    .filter((u) => {
      const p = { id: u.id, role: u.role } as unknown as UserProfile;
      return hasCapability(p, "checklist") && !isManager(p);
    })
    .map((u) => ({ id: u.id, name: u.full_name ?? u.email ?? u.id, email: u.email ?? "" }));
}

/** Send a notification email via the manager-gated Graph route. Fail-soft:
 *  returns {ok:false,error} instead of throwing, so the priority stays saved. */
export async function sendNotification(
  to: string[],
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, error: "Not signed in." };
    const res = await fetch("/api/priorities/notify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html }),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return res.ok && j.ok ? { ok: true } : { ok: false, error: j.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email request failed." };
  }
}

/** id → {name,email} for every user (display names; fail-soft). */
export async function fetchUserDirectory(): Promise<Map<string, AssignableUser>> {
  const map = new Map<string, AssignableUser>();
  const { data, error } = await supabase.from("users").select("id, full_name, email");
  if (error) return map;
  for (const u of data ?? []) {
    map.set(u.id, { id: u.id, name: u.full_name ?? u.email ?? u.id, email: u.email ?? "" });
  }
  return map;
}
