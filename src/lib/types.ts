// Shared domain and database types for the Supabase typed client.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Capabilities that gate access to feature areas of the app. */
export type Capability = "checklist" | "finance" | "cocoblu";

/**
 * A row in `public.users`. This mirrors the profile record that is loaded
 * after authentication. Adjust columns here as the schema evolves.
 */
export interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  created_at: string | null;
}

/**
 * Minimal typed view of the database used by the Supabase client. Only the
 * tables the app reads/writes are declared; extend as more are added.
 */
export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserProfile;
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          role?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          role?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
