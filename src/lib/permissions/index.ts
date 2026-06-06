import type { Capability } from "@/lib/types";

import { ALL_CAPABILITIES, CAPABILITY_MAP } from "./capabilities";

export { ALL_CAPABILITIES, CAPABILITY_MAP } from "./capabilities";
export type { CapabilityGrant } from "./capabilities";

type UserId = string | null | undefined;

/** True when the user holds an unrestricted ("all") grant. */
function hasAllGrant(userId: UserId): boolean {
  if (!userId) return false;
  return CAPABILITY_MAP[userId] === "all";
}

/**
 * Resolve the concrete list of capabilities a user holds. An "all" grant is
 * expanded into every known capability. Unknown users hold nothing.
 */
export function getCapabilities(userId: UserId): Capability[] {
  if (!userId) return [];
  const grant = CAPABILITY_MAP[userId];
  if (!grant) return [];
  if (grant === "all") return [...ALL_CAPABILITIES];
  return [...grant];
}

/**
 * A "manager" is any user present in the capability map — i.e. a user who has
 * been explicitly granted elevated access to one or more feature areas.
 */
export function isManager(userId: UserId): boolean {
  if (!userId) return false;
  return userId in CAPABILITY_MAP;
}

/** True when the user holds the given capability. */
export function hasCapability(userId: UserId, capability: Capability): boolean {
  return getCapabilities(userId).includes(capability);
}

export function canViewChecklist(userId: UserId): boolean {
  return hasCapability(userId, "checklist");
}

export function canViewFinance(userId: UserId): boolean {
  return hasCapability(userId, "finance");
}

export function canViewCocoblu(userId: UserId): boolean {
  return hasCapability(userId, "cocoblu");
}

/**
 * Whether `viewerId` is allowed to see data belonging to `targetUserId`.
 * Users may always view their own data; only holders of an "all" grant may
 * view other users' data.
 */
export function canViewUser(viewerId: UserId, targetUserId: UserId): boolean {
  if (!viewerId || !targetUserId) return false;
  if (viewerId === targetUserId) return true;
  return hasAllGrant(viewerId);
}

/**
 * Returns the user id that data queries should be scoped to for `viewerId`.
 *
 * - `null` means "no scoping" — the viewer holds an "all" grant and may see
 *   every user's data.
 * - Otherwise the viewer's own id is returned, restricting results to data
 *   that belongs to them.
 */
export function scopeToUser(viewerId: UserId): string | null {
  if (hasAllGrant(viewerId)) return null;
  return viewerId ?? null;
}
