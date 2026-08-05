import type { Capability, UserProfile } from "@/lib/types";

import { ALL_CAPABILITIES, CAPABILITY_MAP } from "./capabilities";

export { ALL_CAPABILITIES, CAPABILITY_MAP } from "./capabilities";
export type { CapabilityGrant } from "./capabilities";

type ProfileArg = UserProfile | null | undefined;

/** The role value that grants cross-user (manager override) access. */
const MANAGER_ROLE = "manager";

/** Superuser UID — always gets all capabilities, regardless of DB state. */
const SUPERUSER_UID = "c4abda49-13e9-41fd-acae-88acd4aa7fcb";

/** Type guard: checks whether a string is a known Capability. */
export function isCapability(s: string): s is Capability {
  return ALL_CAPABILITIES.includes(s as Capability);
}

/**
 * Manager override is driven by the profile's `role`, NOT by the capability
 * map. The capability map governs only which feature *modules* a user can see.
 */
export function isManager(profile: ProfileArg): boolean {
  return profile?.role === MANAGER_ROLE;
}

/**
 * Resolve the concrete list of *module* capabilities a profile holds.
 *
 * Priority order:
 * 1. Superuser hardcoded bypass → all capabilities (cannot be revoked via UI).
 * 2. Non-empty `portal_access` array on the profile → filtered to valid Capability values.
 * 3. Fall back to `CAPABILITY_MAP[profile.id]` (static per-user grants).
 */
export function getCapabilities(profile: ProfileArg): Capability[] {
  if (!profile) return [];

  // 1. Superuser bypass — always returns all capabilities.
  if (profile.id === SUPERUSER_UID) return [...ALL_CAPABILITIES];

  // 2. DB-driven portal_access (set by RBAC role assignments).
  const portalAccess = profile.portal_access;
  if (Array.isArray(portalAccess) && portalAccess.length > 0) {
    return portalAccess.filter(isCapability);
  }

  // 3. Static capability map fallback.
  const grant = CAPABILITY_MAP[profile.id];
  if (!grant) return [];
  if (grant === "all") return [...ALL_CAPABILITIES];
  return [...grant];
}

/** True when the profile holds the given module capability. */
export function hasCapability(
  profile: ProfileArg,
  capability: Capability
): boolean {
  return getCapabilities(profile).includes(capability);
}

export function canViewChecklist(profile: ProfileArg): boolean {
  return hasCapability(profile, "checklist");
}

export function canViewFinance(profile: ProfileArg): boolean {
  return hasCapability(profile, "finance");
}

/** Amazon Seller Central page access (any seller_* grant or finance). */
export function canViewSellerCentral(profile: ProfileArg): boolean {
  return (
    hasCapability(profile, "finance") ||
    hasCapability(profile, "seller_central") ||
    hasCapability(profile, "seller_orders") ||
    hasCapability(profile, "seller_finance")
  );
}

/** Seller orders + buyer messages + returns tabs (Aaron, managers). */
export function canViewSellerOrders(profile: ProfileArg): boolean {
  return hasCapability(profile, "seller_orders");
}

/** Seller finance / payment tab (Maricel, managers). */
export function canViewSellerFinance(profile: ProfileArg): boolean {
  return hasCapability(profile, "seller_finance") || hasCapability(profile, "finance");
}

export function canViewCocoblu(profile: ProfileArg): boolean {
  return hasCapability(profile, "cocoblu");
}

export function canViewLpTracker(profile: ProfileArg): boolean {
  return hasCapability(profile, "lp_tracker");
}

export function canViewStockReservation(profile: ProfileArg): boolean {
  return hasCapability(profile, "stock_reservation") || hasCapability(profile, "stock_reservation_manager");
}

export function canManageStockReservation(profile: ProfileArg): boolean {
  return hasCapability(profile, "stock_reservation_manager");
}

export function canViewConsults(profile: ProfileArg): boolean {
  return hasCapability(profile, "consults") || isManager(profile);
}

export function canViewAccounts(profile: ProfileArg): boolean {
  return hasCapability(profile, "accounts") || isManager(profile);
}

/**
 * Logistics page keys. Full-access users (logistics role / manager / logistics
 * capability) see every page; specific staff can be granted individual pages by
 * user id below (e.g. Maricel handles reseller/PRT/reports, Aaron handles the
 * Shopify order channel) without giving them the whole portal.
 */
export type LogisticsPage =
  | "dashboard"
  | "orders"
  | "reseller"
  | "cargo"
  | "prt"
  | "reports"
  | "marketplace"
  | "masters"
  | "amazon_fulfillment"
  | "amazon_profit"
  | "noon";

const LOGISTICS_PAGE_GRANTS: Readonly<Record<string, readonly LogisticsPage[]>> = {
  // Maricel — also documents Amazon return paperwork (invoice/PRT/SRT) + Noon returns
  "227fdb27-80b5-4040-ab14-4bb945068af7": ["reseller", "prt", "reports", "marketplace", "amazon_fulfillment", "amazon_profit", "noon"],
  // Aaron
  "cbb81b27-8756-4f2d-bfe0-04211c27092c": ["orders", "reseller"],
};

/** Which logistics pages a profile may access — "all" or an explicit list. */
export function logisticsPages(profile: ProfileArg): "all" | readonly LogisticsPage[] {
  if (isManager(profile) || profile?.role === "logistics" || hasCapability(profile, "logistics")) {
    return "all";
  }
  return LOGISTICS_PAGE_GRANTS[profile?.id ?? ""] ?? [];
}

/** May the user see the Logistics portal at all (full access OR any page grant)? */
export function canViewLogistics(profile: ProfileArg): boolean {
  const pages = logisticsPages(profile);
  if (pages === "all" || pages.length > 0) return true;
  // A standalone "noon" capability also grants portal entry (for the Noon page only).
  return hasCapability(profile, "noon");
}

/** May the user access a specific logistics page? */
export function canViewLogisticsPage(profile: ProfileArg, page: LogisticsPage): boolean {
  // Master data management is manager/admin only — never the logistics user.
  if (page === "masters") return isManager(profile) || profile?.role === "admin";
  // Noon page can be granted via the "noon" capability independently of full logistics access.
  if (page === "noon" && hasCapability(profile, "noon")) return true;
  const pages = logisticsPages(profile);
  return pages === "all" || pages.includes(page);
}

/**
 * A dedicated logistics user who must ONLY see the Logistics portal (not a manager).
 * Covers both the legacy `role = "logistics"` column and RBAC-assigned users whose
 * portal_access contains only the "logistics" capability.
 */
export function isLogisticsOnly(profile: ProfileArg): boolean {
  if (!profile || isManager(profile)) return false;
  if (profile.role === "logistics") return true;
  const caps = getCapabilities(profile);
  return caps.length > 0 && caps.every((c) => c === "logistics");
}

/**
 * A user confined to LP Tracker only — holds lp_tracker and nothing else.
 * Capability-driven so assigning any additional role via the admin UI
 * automatically removes this confinement.
 */
export function isLpOnly(profile: ProfileArg): boolean {
  if (!profile || isManager(profile)) return false;
  const caps = getCapabilities(profile);
  return caps.length > 0 && caps.every((c) => c === "lp_tracker");
}

/**
 * Whether `profile` is allowed to see data belonging to `targetUserId`.
 * Users may always view their own data; managers (role === "manager") may view
 * any user's data.
 */
export function canViewUser(
  profile: ProfileArg,
  targetUserId: string | null | undefined
): boolean {
  if (!profile || !targetUserId) return false;
  if (profile.id === targetUserId) return true;
  return isManager(profile);
}

/**
 * Minimal shape of a chainable query (e.g. a Supabase PostgrestFilterBuilder)
 * that {@link scopeToUser} can constrain. Keeping this structural avoids a hard
 * dependency on the concrete builder type while staying free of `any`.
 */
interface ScopableQuery<T> {
  eq(column: string, value: string): T;
}

/**
 * Scope a query to the data the given profile is allowed to read.
 *
 * - Managers (role === "manager") get the query back unchanged — they may read
 *   every user's rows.
 * - Everyone else is constrained to rows they own via `column` (default
 *   `assigned_to`, matching the Phase 1 `daily_tasks` / `task_definitions`
 *   schema). When no profile is present the query is constrained to an empty
 *   owner id so it matches nothing (fail closed).
 */
export function scopeToUser<T extends ScopableQuery<T>>(
  query: T,
  profile: ProfileArg,
  column = "assigned_to"
): T {
  if (isManager(profile)) return query;
  return query.eq(column, profile?.id ?? "");
}
