import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type HolidayRow = Tables<"company_holidays">;

/** All company holidays, soonest first. Readable by any signed-in user. */
export async function fetchHolidays(): Promise<HolidayRow[]> {
  const { data, error } = await supabase
    .from("company_holidays")
    .select("*")
    .order("holiday_date", { ascending: false })
    .limit(200);
  if (error) return [];
  return data ?? [];
}

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("You must be signed in.");
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}

/** Manager-only: mark a date (YYYY-MM-DD) a holiday + clear that day's tasks. */
export async function addHoliday(date: string, label?: string): Promise<void> {
  const res = await fetch("/api/checklist/holiday", {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ date, label }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}

/** Manager-only: remove a holiday. */
export async function removeHoliday(date: string): Promise<void> {
  const res = await fetch(`/api/checklist/holiday?date=${encodeURIComponent(date)}`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}
