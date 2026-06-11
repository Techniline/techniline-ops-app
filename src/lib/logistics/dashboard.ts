import { supabase } from "@/lib/supabaseClient";

export interface LogisticsKpis {
  shopifyToday: number;
  pendingFulfillment: number;
  trackingPending: number;
  prtRequested: number;
  readyToDispatch: number;
  deliveredToday: number;
  delayed24: number;
  delayed48: number;
  onHold: number;
  resellerPending: number;
  cargoPending: number;
  /** Set when the logistics tables aren't created yet, so the UI can prompt setup. */
  notSetUp: boolean;
}

const EMPTY: LogisticsKpis = {
  shopifyToday: 0,
  pendingFulfillment: 0,
  trackingPending: 0,
  prtRequested: 0,
  readyToDispatch: 0,
  deliveredToday: 0,
  delayed24: 0,
  delayed48: 0,
  onHold: 0,
  resellerPending: 0,
  cargoPending: 0,
  notSetUp: false,
};

const PENDING_STATUSES = [
  "new_order",
  "checking_stock",
  "awaiting_branch",
  "prt_requested",
  "ready_to_dispatch",
  "tracking_pending",
];

/** Unwrap a count query into a plain number; reports whether the table is missing. */
async function take(
  p: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<{ n: number; missing: boolean }> {
  const { count, error } = await p;
  if (error) return { n: 0, missing: true };
  return { n: count ?? 0, missing: false };
}

export async function fetchLogisticsKpis(): Promise<LogisticsKpis> {
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const todayIso = startToday.toISOString();
  const ago24 = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const ago48 = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();

  const orders = () => supabase.from("shopify_orders").select("*", { count: "exact", head: true });

  try {
    const [
      shopifyToday,
      pendingFulfillment,
      trackingPending,
      readyToDispatch,
      onHold,
      deliveredToday,
      delayed24,
      delayed48,
      prtRequested,
      resellerPending,
      cargoPending,
    ] = await Promise.all([
      take(orders().gte("shopify_created_at", todayIso)),
      take(orders().in("logistics_status", PENDING_STATUSES)),
      take(orders().eq("logistics_status", "tracking_pending")),
      take(orders().eq("logistics_status", "ready_to_dispatch")),
      take(orders().eq("logistics_status", "issue_hold")),
      take(orders().eq("logistics_status", "delivered").gte("updated_at", todayIso)),
      take(orders().in("logistics_status", PENDING_STATUSES).lt("shopify_created_at", ago24)),
      take(orders().in("logistics_status", PENDING_STATUSES).lt("shopify_created_at", ago48)),
      take(
        supabase
          .from("prt_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "requested"),
      ),
      take(
        supabase
          .from("reseller_deliveries")
          .select("*", { count: "exact", head: true })
          .not("status", "in", "(delivered,cancelled)"),
      ),
      take(
        supabase
          .from("cargo_deliveries")
          .select("*", { count: "exact", head: true })
          .not("status", "in", "(delivered,cancelled)"),
      ),
    ]);

    return {
      shopifyToday: shopifyToday.n,
      pendingFulfillment: pendingFulfillment.n,
      trackingPending: trackingPending.n,
      prtRequested: prtRequested.n,
      readyToDispatch: readyToDispatch.n,
      deliveredToday: deliveredToday.n,
      delayed24: delayed24.n,
      delayed48: delayed48.n,
      onHold: onHold.n,
      resellerPending: resellerPending.n,
      cargoPending: cargoPending.n,
      notSetUp: shopifyToday.missing,
    };
  } catch {
    return { ...EMPTY, notSetUp: true };
  }
}
