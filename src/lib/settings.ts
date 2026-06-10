import { supabase } from "@/lib/supabaseClient";

/** Read an app-wide setting value (manager-scoped via RLS). Null if unset/blocked. */
export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return data.value ?? null;
}

/** Upsert an app-wide setting (managers only, enforced by RLS). */
export async function setSetting(key: string, value: string, updatedBy: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_by: updatedBy, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export const MONTHLY_SUMMARY_RECIPIENT_KEY = "monthly_summary_recipient";
