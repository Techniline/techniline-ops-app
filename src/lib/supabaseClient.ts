import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types";

// Public env vars are inlined at build time. When they are absent (e.g. during
// CI builds without secrets) we fall back to harmless placeholders so that
// `createClient` does not throw at module-evaluation time. Real values must be
// provided via `.env.local` for the client to actually reach Supabase.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
