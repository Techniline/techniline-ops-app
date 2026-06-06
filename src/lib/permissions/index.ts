import type { Capability, UserProfile } from "@/lib/types";

import { ALL_CAPABILITIES, CAPABILITY_MAP } from "./capabilities";

export { ALL_CAPABILITIES, CAPABILITY_MAP } from "./capabilities";
export type { CapabilityGrant } from "./capabilities";

type ProfileArg = UserProfile | null | undefined;

/** The role value that grants cross-user (manager override) access. */
const MANAGER_ROLE = "manager";

/**
 * Manager override is driven by the profile's `role`, NOT by the capability
 * map. The capability map governs only which feature *modules* a user can see.
 */
export function isManager(profile: ProfileArg): boolean {
  return profile?.role === MANAGER_ROLE;
}

/**
 * Resolve the concrete list of *module* capabilities a profile holds, looked
 * up from the capability map by user id. An "all" grant expands into every
 * known capability. Unknown users hold nothing.
 */
export function getCapabilities(profile: ProfileArg): Capability[] {
  if (!profile) return [];
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

export function canViewCocoblu(profile: ProfileArg): boolean {
  return hasCapability(profile, "cocoblu");
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
 *   `user_id`). When no profile is present the query is constrained to an empty
 *   owner id so it matches nothing (fail closed).
 */
export function scopeToUser<T extends ScopableQuery<T>>(
  query: T,
  profile: ProfileArg,
  column = "user_id"
): T {
  if (isManager(profile)) return query;
  return query.eq(column, profile?.id ?? "");
}
