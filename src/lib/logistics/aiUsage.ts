import { createClient } from "@supabase/supabase-js";

// claude-sonnet-4-6 pricing (USD per million tokens).
const IN_PER_M = 3;
const OUT_PER_M = 15;

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Record one Claude document-extraction call. Best-effort and server-only —
 * never throws (a logging failure must not break parsing).
 */
export async function logAiUsage(source: string, model: string, usage: Usage | undefined): Promise<void> {
  try {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !service || !usage) return;
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cost = Number(((input / 1e6) * IN_PER_M + (output / 1e6) * OUT_PER_M).toFixed(5));
    const svc = createClient(url, service, { auth: { persistSession: false } });
    await svc.from("ai_usage").insert({ source, model, input_tokens: input, output_tokens: output, cost_usd: cost });
  } catch {
    /* best-effort */
  }
}
