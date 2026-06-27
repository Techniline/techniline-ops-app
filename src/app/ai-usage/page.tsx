"use client";

import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { surface, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabaseClient";
import { fetchAiUsage, MODULE_LABELS, moduleLabel, type AiUsageSummary } from "@/lib/aiUsage";

// ── helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function defaultRange() {
  const now = new Date();
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) };
}
function fmtCost(n: number) { return `$${n.toFixed(n < 0.01 ? 5 : 4)}`; }
function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

const MODULE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(MODULE_LABELS).map(([k, v]) => [k, v.color])
);
function modColor(s: string) { return MODULE_COLORS[s] ?? "#64748b"; }

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: { date: string; calls: number }[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map((d) => d.calls), 1);
  const W = 300, H = 48, pad = 3;
  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - ((d.calls / max) * (H - pad * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: H }}>
      <defs>
        <linearGradient id="spfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${pad},${H} ${pts.join(" ")} ${W - pad},${H}`} fill="url(#spfill)" />
      <polyline points={pts.join(" ")} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => {
        const x = pad + (i / (data.length - 1)) * (W - pad * 2);
        const y = H - pad - ((d.calls / max) * (H - pad * 2));
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.5" fill="#6366f1" stroke="white" strokeWidth="1" />;
      })}
    </svg>
  );
}

// ── Module bar card ───────────────────────────────────────────────────────────

function ModuleBar({ mod, maxCalls }: { mod: AiUsageSummary["byModule"][0]; maxCalls: number }) {
  const pct = maxCalls > 0 ? (mod.calls / maxCalls) * 100 : 0;
  const color = modColor(mod.source);
  const desc = MODULE_LABELS[mod.source]?.description ?? "";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/50">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white" style={{ background: color }}>AI</span>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{mod.label}</p>
            {desc ? <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{desc}</p> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{mod.calls.toLocaleString()} calls</p>
          <p className="text-xs text-slate-500">{fmtCost(mod.cost)}</p>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-slate-400">
        <span>In: {fmtK(mod.inputTokens)} tokens</span>
        <span>Out: {fmtK(mod.outputTokens)} tokens</span>
        <span>Avg {fmtCost(mod.avgCost)}/call</span>
      </div>
    </div>
  );
}

// ── Paginated log ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

function DetailLog({ data }: { data: AiUsageSummary }) {
  const [page, setPage] = useState(0);
  const [moduleFilter, setModuleFilter] = useState("all");

  const filtered = moduleFilter === "all"
    ? data.rows
    : data.rows.filter((r) => r.source === moduleFilter);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className={`${surface} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Call log</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800">{filtered.length.toLocaleString()} rows</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Filter module:</span>
          <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(0); }} className={`${inputClass} max-w-[200px] py-1 text-xs`}>
            <option value="all">All modules</option>
            {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr>
              {["Time", "Module", "Model", "In tokens", "Out tokens", "Cost (USD)"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/30">
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                  {r.created_at ? new Date(r.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: modColor(r.source ?? "") }}>
                    {moduleLabel(r.source)}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-slate-400 whitespace-nowrap">{r.model ?? "—"}</td>
                <td className="px-4 py-2 tabular-nums text-right text-slate-600 dark:text-slate-300">{(r.input_tokens ?? 0).toLocaleString()}</td>
                <td className="px-4 py-2 tabular-nums text-right text-slate-600 dark:text-slate-300">{(r.output_tokens ?? 0).toLocaleString()}</td>
                <td className="px-4 py-2 tabular-nums text-right font-medium text-slate-700 dark:text-slate-200">{fmtCost(r.cost_usd ?? 0)}</td>
              </tr>
            ))}
            {slice.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No records for this filter.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 dark:border-slate-800">
        <p className="text-xs text-slate-400">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}
          {filtered.length === 5000 ? " (capped at 5,000 — export CSV for full list)" : ""}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setPage(0)} disabled={page === 0}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">«</button>
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">‹ Prev</button>
          <span className="px-2 text-xs text-slate-500">Page {page + 1} of {pages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">Next ›</button>
          <button type="button" onClick={() => setPage(pages - 1)} disabled={page >= pages - 1}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">»</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AiUsageContent() {
  const def = defaultRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showEmail, setShowEmail] = useState(false);

  function applyPreset(preset: "thisMonth" | "lastMonth" | "last30" | "last90") {
    const now = new Date();
    let f: string, t: string;
    if (preset === "thisMonth") { f = isoDate(new Date(now.getFullYear(), now.getMonth(), 1)); t = isoDate(now); }
    else if (preset === "lastMonth") {
      f = isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      t = isoDate(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (preset === "last30") { f = isoDate(new Date(now.getTime() - 30 * 86400000)); t = isoDate(now); }
    else { f = isoDate(new Date(now.getTime() - 90 * 86400000)); t = isoDate(now); }
    setFrom(f); setTo(t);
  }

  async function runReport(f = from, t = to) {
    setLoading(true);
    setData(null);
    setApplied({ from: f, to: t });
    try {
      const result = await fetchAiUsage(`${f}T00:00:00.000Z`, `${t}T23:59:59.999Z`);
      setData(result);
    } finally { setLoading(false); }
  }

  function exportCsv() {
    if (!data || !applied) return;
    setExporting(true);
    try {
      const lines = [
        `AI Usage Report — ${applied.from} to ${applied.to}`,
        "",
        "Summary",
        `Total calls,${data.totalCalls}`,
        `Total cost (USD),$${data.totalCost.toFixed(5)}`,
        `Total input tokens,${data.totalInputTokens}`,
        `Total output tokens,${data.totalOutputTokens}`,
        "",
        "By Module",
        "Module,Calls,Cost (USD),Input tokens,Output tokens,Avg cost/call",
        ...data.byModule.map((m) => `"${m.label}",${m.calls},$${m.cost.toFixed(5)},${m.inputTokens},${m.outputTokens},$${m.avgCost.toFixed(5)}`),
        "",
        "Daily Breakdown",
        "Date,Calls,Cost (USD)",
        ...data.byDay.map((d) => `${d.date},${d.calls},$${d.cost.toFixed(5)}`),
        "",
        "Detail Log",
        "Timestamp,Module,Model,Input tokens,Output tokens,Cost (USD)",
        ...data.rows.map((r) => `"${r.created_at ?? ""}","${moduleLabel(r.source)}","${r.model ?? ""}",${r.input_tokens ?? 0},${r.output_tokens ?? 0},$${(r.cost_usd ?? 0).toFixed(5)}`),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ai-usage-${applied.from}-to-${applied.to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  async function sendEmail() {
    if (!data || !applied || !emailTo.includes("@")) return;
    setEmailing(true); setEmailMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/ai-usage/email", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailTo,
          fromIso: `${applied.from}T00:00:00.000Z`,
          toIso: `${applied.to}T23:59:59.999Z`,
          rows: data.rows,
          summary: { totalCalls: data.totalCalls, totalCost: data.totalCost, totalInputTokens: data.totalInputTokens, totalOutputTokens: data.totalOutputTokens, byModule: data.byModule },
        }),
      });
      const j = await res.json() as { ok?: boolean; sentTo?: string; error?: string };
      setEmailMsg(j.ok ? { ok: true, text: `Sent to ${j.sentTo}` } : { ok: false, text: j.error ?? "Failed" });
    } catch (e) { setEmailMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setEmailing(false); }
  }

  const maxCalls = data ? Math.max(...data.byModule.map((m) => m.calls), 1) : 1;
  const hasResults = data && data.totalCalls > 0;

  return (
    <div>
      <PageHeader title="AI Usage" subtitle="Filter by date to view usage, costs, and module breakdown for all Claude AI calls." />

      {/* ── Filter card ── */}
      <div className={`${surface} mb-5 p-4`}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Date range</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass}`} />
            </div>
            <span className="mt-5 text-slate-400">→</span>
            <div>
              <label className="mb-1 block text-xs text-slate-500">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass}`} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(["thisMonth", "lastMonth", "last30", "last90"] as const).map((p) => (
              <button key={p} type="button" onClick={() => applyPreset(p)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                {p === "thisMonth" ? "This month" : p === "lastMonth" ? "Last month" : p === "last30" ? "Last 30 days" : "Last 90 days"}
              </button>
            ))}
          </div>

          <button type="button" onClick={() => void runReport()} disabled={loading}
            className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            style={{ boxShadow: "0 2px 8px rgba(99,102,241,.35)" }}>
            {loading ? (
              <><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Running…</>
            ) : "▶ Run report"}
          </button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {!loading && !data && (
        <div className={`${surface} flex flex-col items-center justify-center gap-3 p-16 text-center`}>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40">
            <span className="text-2xl">🤖</span>
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Select a date range and run the report</p>
          <p className="text-xs text-slate-400">You'll see token usage, cost breakdown by module, daily trend, and a paginated call log.</p>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className={`${surface} p-12 text-center text-sm text-slate-400`}>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500 mr-2" />
          Loading AI usage for {from} → {to}…
        </div>
      )}

      {/* ── No data ── */}
      {!loading && data && data.totalCalls === 0 && (
        <div className={`${surface} p-12 text-center text-sm text-slate-400`}>
          No AI calls recorded between {applied?.from} and {applied?.to}.
        </div>
      )}

      {/* ── Results ── */}
      {!loading && hasResults && (
        <>
          {/* Actions row */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Showing results for <span className="font-semibold text-slate-700 dark:text-slate-300">{applied?.from}</span> → <span className="font-semibold text-slate-700 dark:text-slate-300">{applied?.to}</span>
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={exportCsv} disabled={exporting}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                ⬇ {exporting ? "Exporting…" : "Export CSV"}
              </button>
              <button type="button" onClick={() => { setShowEmail((v) => !v); setEmailMsg(null); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${showEmail ? "bg-indigo-100 text-indigo-700" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
                ✉ Email report
              </button>
            </div>
          </div>

          {/* Email input */}
          {showEmail && (
            <div className={`${surface} mb-4 flex flex-wrap items-center gap-3 p-4`}>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Send to:</label>
              <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)}
                placeholder="email@techniline.org" className={`${inputClass} flex-1 max-w-sm`} />
              <button type="button" onClick={() => void sendEmail()} disabled={emailing || !emailTo.includes("@")}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {emailing ? "Sending…" : "Send"}
              </button>
              {emailMsg && (
                <span className={`text-xs font-medium ${emailMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{emailMsg.text}</span>
              )}
            </div>
          )}

          {/* KPI tiles */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total AI calls", value: data.totalCalls.toLocaleString(), sub: `${applied?.from} – ${applied?.to}`, color: "#6366f1" },
              { label: "Total cost", value: fmtCost(data.totalCost), sub: "USD · Claude Sonnet 4.6", color: "#7c3aed" },
              { label: "Input tokens", value: fmtK(data.totalInputTokens), sub: "prompt tokens", color: "#0891b2" },
              { label: "Output tokens", value: fmtK(data.totalOutputTokens), sub: "extraction tokens", color: "#059669" },
            ].map((t) => (
              <div key={t.label} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/50"
                style={{ borderLeftWidth: 4, borderLeftColor: t.color }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{t.value}</p>
                <p className="mt-0.5 text-xs text-slate-400">{t.sub}</p>
              </div>
            ))}
          </div>

          {/* Trend + by-module */}
          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <div className={`${surface} p-5`}>
              <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Daily calls trend</h2>
              {data.byDay.length >= 2 ? (
                <>
                  <Sparkline data={data.byDay} />
                  <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                    <span>{data.byDay[0]?.date}</span>
                    <span>{data.byDay[data.byDay.length - 1]?.date}</span>
                  </div>
                </>
              ) : <p className="text-sm text-slate-400">Not enough data for a trend.</p>}
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead><tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="pb-1.5 text-left text-slate-400">Date</th>
                    <th className="pb-1.5 text-center text-slate-400">Calls</th>
                    <th className="pb-1.5 text-right text-slate-400">Cost (USD)</th>
                  </tr></thead>
                  <tbody>
                    {[...data.byDay].reverse().slice(0, 20).map((d) => (
                      <tr key={d.date} className="border-t border-slate-50 dark:border-slate-800/50">
                        <td className="py-1 text-slate-600 dark:text-slate-300">{d.date}</td>
                        <td className="py-1 text-center tabular-nums">{d.calls}</td>
                        <td className="py-1 text-right tabular-nums text-slate-500">{fmtCost(d.cost)}</td>
                      </tr>
                    ))}
                    {data.byDay.length > 20 && (
                      <tr><td colSpan={3} className="pt-2 text-[11px] text-slate-400">+{data.byDay.length - 20} more days — export CSV</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`${surface} p-5`}>
              <h2 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Breakdown by module</h2>
              <div className="flex flex-col gap-3">
                {data.byModule.map((m) => <ModuleBar key={m.source} mod={m} maxCalls={maxCalls} />)}
              </div>
            </div>
          </div>

          {/* Paginated log */}
          <DetailLog data={data} />
        </>
      )}
    </div>
  );
}

export default function AiUsagePage() {
  return (
    <RouteGuard>
      <AppShell>
        <AiUsageContent />
      </AppShell>
    </RouteGuard>
  );
}
