import { supabase } from "@/lib/supabaseClient";

export interface StageBucket {
  stage: string;
  count: number;
  value: number;
}
export interface PipelineKpis {
  pipeline: string;
  openCount: number;
  openValue: number;
  wonCount: number;
  wonValue: number;
  totalCount: number;
  byStage: StageBucket[];
}
export interface PipelineKpisResult {
  configured: boolean;
  pipelines: PipelineKpis[];
  error?: string;
}

/** Fetch Zoho pipeline KPIs (manager / Aaron) via the server route. */
export async function fetchPipelineKpis(): Promise<PipelineKpisResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { configured: false, pipelines: [] };
  const res = await fetch("/api/zoho/pipeline-kpis", { headers: { Authorization: `Bearer ${token}` } });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean; configured?: boolean; pipelines?: PipelineKpis[]; error?: string;
  };
  if (!res.ok || !j.ok) return { configured: false, pipelines: [], error: j.error };
  return { configured: !!j.configured, pipelines: j.pipelines ?? [] };
}
