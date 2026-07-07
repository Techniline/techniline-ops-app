// Source of truth for database shapes is the generated file
// `database.types.ts` (produced by `supabase gen types typescript`).
// Do NOT hand-edit table shapes here — regenerate that file instead.

export type { Database, Json } from "./database.types";
export type { Tables, TablesInsert, TablesUpdate, Enums } from "./database.types";

import type { Tables } from "./database.types";

/** Capabilities that gate access to feature areas of the app (app-level, not a DB concept). */
export type Capability =
  | "checklist"
  | "finance"
  | "cocoblu"
  | "lp_tracker"
  | "logistics"
  | "seller_central"
  | "seller_orders"
  | "seller_finance"
  | "stock_reservation"
  | "stock_reservation_manager"
  | "consults";

/** A row in `public.users`, derived from the generated types. */
export type UserProfile = Tables<"users">;
