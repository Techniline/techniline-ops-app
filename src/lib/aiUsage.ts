import { supabase } from "@/lib/supabaseClient";
import type { Tables } from "@/lib/types";

export type AiUsageRow = Tables<"ai_usage">;

export const MODULE_LABELS: Record<string, { label: string; description: string; color: string }> = {
  "logistics-invoice":  { label: "Logistics Invoice",   description: "Extracts invoice number, SKUs and totals from TLE tax invoice PDFs",        color: "#6366f1" },
  "parse-doc":          { label: "Logistics Documents",  description: "Parses delivery notes and invoices into a unified structured format",         color: "#0891b2" },
  "lp-parse":           { label: "LP Tracker",           description: "Extracts header and line items from Local Purchase Order PDFs",               color: "#7c3aed" },
  "cocoblu-invoice":    { label: "Cocoblu Invoices",     description: "Parses Cocoblu/Microless supplier invoice PDFs into structured line items",   color: "#059669" },
};

export function moduleLabel(source: string | null): string {
  return MODULE_LABELS[source ?? ""]?.label ?? source ?? "Unknown";
}

export interface AiUsageSummary {
  rows: AiUsageRow[];
  totalCalls: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModule: {
    source: string;
    label: string;
    calls: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    avgCost: number;
  }[];
  byDay: { date: string; calls: number; cost: number }[];
}

export async function fetchAiUsage(fromIso: string, toIso: string): Promise<AiUsageSummary> {
  const { data } = await supabase
    .from("ai_usage")
    .select("*")
    .gte("created_at", fromIso)
    .lt("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  const rows = (data as AiUsageRow[]) ?? [];

  let totalCost = 0, totalInputTokens = 0, totalOutputTokens = 0;
  const modMap = new Map<string, { calls: number; cost: number; inp: number; out: number }>();
  const dayMap = new Map<string, { calls: number; cost: number }>();

  for (const r of rows) {
    const cost = r.cost_usd ?? 0;
    const inp = r.input_tokens ?? 0;
    const out = r.output_tokens ?? 0;
    totalCost += cost;
    totalInputTokens += inp;
    totalOutputTokens += out;

    const src = r.source ?? "unknown";
    const mod = modMap.get(src) ?? { calls: 0, cost: 0, inp: 0, out: 0 };
    mod.calls += 1; mod.cost += cost; mod.inp += inp; mod.out += out;
    modMap.set(src, mod);

    const day = (r.created_at ?? "").slice(0, 10);
    if (day) {
      const d = dayMap.get(day) ?? { calls: 0, cost: 0 };
      d.calls += 1; d.cost += cost;
      dayMap.set(day, d);
    }
  }

  const byModule = [...modMap.entries()].map(([source, m]) => ({
    source,
    label: moduleLabel(source),
    calls: m.calls,
    cost: m.cost,
    inputTokens: m.inp,
    outputTokens: m.out,
    avgCost: m.calls > 0 ? m.cost / m.calls : 0,
  })).sort((a, b) => b.calls - a.calls);

  const byDay = [...dayMap.entries()]
    .map(([date, d]) => ({ date, ...d }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { rows, totalCalls: rows.length, totalCost, totalInputTokens, totalOutputTokens, byModule, byDay };
}
