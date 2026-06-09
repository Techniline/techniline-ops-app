import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type ResellerDealLog = Tables<"reseller_deal_logs">;

/** Maricel's Zoho deal-owner email (deals owned by others are flagged in the KPI). */
export const RESELLER_OWNER_EMAIL = "eops@techniline.org";

/** Validate + log a deal via the server route (handles Zoho + DB write). */
export async function validateDealViaApi(
  dealInput: string,
  inquiryNote: string | null
): Promise<ResellerDealLog> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/zoho/validate-deal", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dealInput, inquiryNote }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; log?: ResellerDealLog; error?: string };
  if (!res.ok || !json.ok || !json.log) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.log;
}

/** Recent deal logs the profile may see (RLS-scoped). Newest first. */
export async function fetchDealLogs(): Promise<ResellerDealLog[]> {
  const { data, error } = await supabase
    .from("reseller_deal_logs")
    .select("*")
    .order("logged_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return data ?? [];
}

export interface ResellerKpis {
  today: number;
  week: number;
  month: number;
  valid: number;
  pending: number; // validation_status = pending_validation
  invalid: number; // validation_status = invalid
  apiError: number; // validation_status = api_error
  notOwned: number; // valid deals owned by someone other than Maricel
  createdOutsideToday: number; // logged today but deal created on an earlier day
  totalValue: number; // sum of amount on valid deals
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Compute KPI figures from logged rows (all local-time based). */
export function computeResellerKpis(rows: ResellerDealLog[], ownerEmail = RESELLER_OWNER_EMAIL): ResellerKpis {
  const now = new Date();
  const today = ymd(now);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
  const weekStartStr = ymd(weekStart);
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const k: ResellerKpis = {
    today: 0, week: 0, month: 0, valid: 0, pending: 0, invalid: 0, apiError: 0,
    notOwned: 0, createdOutsideToday: 0, totalValue: 0,
  };

  for (const r of rows) {
    const loggedDay = (r.logged_at ?? "").slice(0, 10);
    if (loggedDay === today) k.today += 1;
    if (loggedDay >= weekStartStr) k.week += 1;
    if (loggedDay >= monthStart) k.month += 1;

    if (r.validation_status === "valid") {
      k.valid += 1;
      if (r.amount != null) k.totalValue += r.amount;
      if (r.owner_email && r.owner_email.toLowerCase() !== ownerEmail.toLowerCase()) k.notOwned += 1;
      const createdDay = (r.deal_created_time ?? "").slice(0, 10);
      if (loggedDay === today && createdDay && createdDay !== today) k.createdOutsideToday += 1;
    } else if (r.validation_status === "invalid") {
      k.invalid += 1;
    } else if (r.validation_status === "api_error") {
      k.apiError += 1;
    } else if (r.validation_status === "pending_validation") {
      k.pending += 1;
    }
  }
  return k;
}
