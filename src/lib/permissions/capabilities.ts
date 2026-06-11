import type { Capability } from "@/lib/types";

/** Every capability the app knows about, in display order. */
export const ALL_CAPABILITIES: readonly Capability[] = [
  "checklist",
  "finance",
  "cocoblu",
  "lp_tracker",
  "logistics",
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
  // Maricel
  "227fdb27-80b5-4040-ab14-4bb945068af7": ["checklist", "finance", "lp_tracker"],
  // Aaron
  "cbb81b27-8756-4f2d-bfe0-04211c27092c": ["checklist", "cocoblu"],
  // Vihan
  "c4abda49-13e9-41fd-acae-88acd4aa7fcb": "all",
};
