import type { Capability } from "@/lib/types";

/** Every capability the app knows about, in display order. */
export const ALL_CAPABILITIES: readonly Capability[] = [
  "checklist",
  "finance",
  "cocoblu",
  "lp_tracker",
  "logistics",
  "seller_central",
  "seller_orders",
  "seller_finance",
  "stock_reservation",
  "stock_reservation_manager",
] as const;

/**
 * A grant is either an explicit list of capabilities or the sentinel "all",
 * which expands to every capability in {@link ALL_CAPABILITIES}.
 */
export type CapabilityGrant = readonly Capability[] | "all";

/**
 * Capability map keyed by `public.users.id` (Supabase auth user id).
 *
 * Permissions are intentionally keyed by user id — never by email — so that
 * changing a user's email address can never alter their access.
 */
export const CAPABILITY_MAP: Readonly<Record<string, CapabilityGrant>> = {
  // Maricel — Amazon Seller Central: payment/finance only
  "227fdb27-80b5-4040-ab14-4bb945068af7": ["checklist", "finance", "lp_tracker", "seller_central", "seller_finance"],
  // Aaron — Amazon Seller Central: orders + buyer messages
  "cbb81b27-8756-4f2d-bfe0-04211c27092c": ["checklist", "cocoblu", "seller_central", "seller_orders"],
  // Pavithran — LP Tracker only (confined to /lp; see LP_ONLY_UIDS)
  "648993fe-d2e7-446a-ad71-c7b3ff81fae7": ["lp_tracker"],
  // Vihan
  "c4abda49-13e9-41fd-acae-88acd4aa7fcb": "all",
  // Stock Reservation team — add user IDs after creating accounts in Supabase
  // Grace (manager): add "stock_reservation" | "stock_reservation_manager"; set role = "manager" on her users row
  // "GRACE_UUID":    ["stock_reservation", "stock_reservation_manager"],
  // "MANOJ_UUID":    ["stock_reservation"],
  // "ASHISH_UUID":   ["stock_reservation"],
  // "NISHANTHA_UUID":["stock_reservation"],
};
