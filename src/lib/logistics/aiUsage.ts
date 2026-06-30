import { createClient } from "@supabase/supabase-js";

// Pricing per million tokens (USD) — input / output
const PRICING: Record<string, [number, number]> = {
  "claude-sonnet-4-6":        [3.00,  15.00],
  "claude-opus-4-8":          [15.00, 75.00],
  "claude-haiku-4-5-20251001": [0.80,   4.00],
  "claude-haiku-4-5":          [0.80,   4.00],
};
const DEFAULT_PRICING: [number, number] = [3.00, 15.00]; // fallback to Sonnet

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
    const [inRate, outRate] = PRICING[model] ?? DEFAULT_PRICING;
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cost = Number(((input / 1e6) * inRate + (output / 1e6) * outRate).toFixed(6));
    const svc = createClient(url, service, { auth: { persistSession: false } });
    await svc.from("ai_usage").insert({ source, model, input_tokens: input, output_tokens: output, cost_usd: cost });
  } catch {
    /* best-effort */
  }
}
