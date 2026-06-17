"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { ManagerScorecard } from "@/components/ManagerScorecard";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import { downloadCsv, printReportHtml, renderTableReportHtml, toCsv } from "@/lib/export";
import { isManager } from "@/lib/permissions";
import {
  addQuality,
  deleteQuality,
  fetchAppraisal,
  fetchQuality,
  fetchReview,
  fetchStaff,
  fetchTrend,
  monthStr,
  QUALITY_CHANNELS,
  saveReview,
  saveTarget,
  type Appraisal,
  type Metric,
  type PerformanceReview,
  type QualityEntry,
  type StaffMember,
  type TrendPoint,
} from "@/lib/analytics";
import type { UserProfile } from "@/lib/types";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Is a metric meeting its target? null = no target set. */
function meetsTarget(m: Metric): boolean | null {
  if (m.target == null) return null;
  return m.higherIsBetter ? m.value >= m.target : m.value <= m.target;
}

function MetricCard({ m, editTargets, onTarget }: { m: Metric; editTargets: boolean; onTarget: (v: string) => void }) {
  const ok = meetsTarget(m);
  const tone = ok == null ? "" : ok ? "ring-emerald-300" : "ring-amber-300";
  return (
    <div className={`relative rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/70 p-4 shadow-sm ring-1 ring-inset ${tone || "ring-white/60"} dark:border-slate-800 dark:from-slate-900 dark:to-slate-950`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{m.label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{m.display}</p>
      {editTargets ? (
        <input
          type="number"
          defaultValue={m.target ?? ""}
          onBlur={(e) => onTarget(e.target.value)}
          placeholder="target"
          className="mt-2 w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
        />
      ) : m.target != null ? (
        <p className={`mt-1 text-[11px] font-medium ${ok ? "text-emerald-600" : "text-amber-600"}`}>
          target {m.target}{m.higherIsBetter ? " min" : " max"} · {ok ? "met" : "below"}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-400">no target set</p>
      )}
    </div>
  );
}

function AppraisalTab({ profile }: { profile: UserProfile }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [month, setMonth] = useState<string>(monthStr(new Date()));
  const [appraisal, setAppraisal] = useState<Appraisal | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [review, setReview] = useState<PerformanceReview | null>(null);
  const [quality, setQuality] = useState<QualityEntry[]>([]);
  const [editTargets, setEditTargets] = useState(false);
  const [rating, setRating] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [qChannel, setQChannel] = useState<string>(QUALITY_CHANNELS[0]);
  const [qSev, setQSev] = useState("medium");
  const [qDesc, setQDesc] = useState("");
  const [qOrder, setQOrder] = useState("");
  const [qStaff, setQStaff] = useState<string>("");
  const [qDate, setQDate] = useState<string>(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    (async () => {
      const s = await fetchStaff();
      setStaff(s);
      if (s.length && !userId) setUserId(s[0]!.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [a, t, r, q] = await Promise.all([
      fetchAppraisal(userId, month),
      fetchTrend(userId, 6),
      fetchReview(userId, month),
      fetchQuality(userId, month),
    ]);
    setAppraisal(a);
    setTrend(t);
    setReview(r);
    setRating(r?.rating != null ? String(r.rating) : "");
    setNotes(r?.notes ?? "");
    setQuality(q);
    setLoading(false);
  }, [userId, month]);
  useEffect(() => { void load(); }, [load]);

  const staffName = staff.find((s) => s.id === userId)?.name ?? "";

  async function setTarget(key: string, raw: string): Promise<void> {
    const v = raw.trim() === "" ? null : Number(raw);
    try { await saveTarget(userId, key, v, profile.id); await load(); } catch (e) { setErr(errMsg(e)); }
  }
  async function saveTheReview(): Promise<void> {
    setErr(null); setBanner(null);
    try {
      await saveReview(userId, month, rating === "" ? null : Number(rating), notes, profile.id);
      setBanner("Review saved.");
    } catch (e) { setErr(errMsg(e)); }
  }
  async function addQ(): Promise<void> {
    if (!qDesc.trim()) { setErr("Add remarks describing what happened."); return; }
    const staffId = qStaff || userId;
    try {
      await addQuality({ userId: staffId, channel: qChannel, severity: qSev, description: qDesc, orderRef: qOrder, occurredOn: qDate, loggedBy: profile.id });
      setQDesc(""); setQOrder(""); setQSev("medium"); setQDate(new Date().toISOString().slice(0, 10));
      await load();
    } catch (e) { setErr(errMsg(e)); }
  }

  function exportPdf(): void {
    if (!appraisal) return;
    const table = {
      title: `Performance Appraisal — ${staffName}`,
      subtitle: `Period: ${month}${rating ? ` · Manager rating: ${rating}/5` : ""}`,
      headers: ["Metric", "Result", "Target"],
      rows: appraisal.metrics.map((m) => [m.label, m.display, m.target != null ? `${m.target} ${m.higherIsBetter ? "min" : "max"}` : "—"]),
    };
    const qualityHtml = quality.length
      ? `<h3 style="margin:14px 0 4px">Quality log</h3><ul>${quality.map((q) => `<li>${q.occurred_on} · [${q.severity}] ${q.channel ?? q.category ?? ""}${q.order_ref ? ` · ${q.order_ref}` : ""} — ${q.description ?? ""}</li>`).join("")}</ul>`
      : "";
    const notesHtml = notes ? `<h3 style="margin:14px 0 4px">Manager notes</h3><p>${notes}</p>` : "";
    printReportHtml(table.title, renderTableReportHtml(table) + notesHtml + qualityHtml);
  }
  function exportCsv(): void {
    if (!appraisal) return;
    downloadCsv(`appraisal-${staffName}-${month}.csv`, toCsv(["Metric", "Result", "Target"], appraisal.metrics.map((m) => [m.label, m.display, m.target ?? ""])));
  }

  const maxRecovery = Math.max(1, ...trend.map((t) => t.recovery));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${inputClass} max-w-[220px]`}>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
        <button type="button" onClick={() => setEditTargets((v) => !v)} className={btnSecondary}>{editTargets ? "Done targets" : "Set targets"}</button>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={exportCsv} className={btnSecondary}>CSV</button>
          <button type="button" onClick={exportPdf} className={btnPrimary}>Export appraisal (PDF)</button>
        </div>
      </div>

      {banner ? <p className="mb-2 text-xs text-emerald-700">{banner}</p> : null}
      {err ? <p className="mb-2 text-xs text-red-600">{err}</p> : null}

      {loading || !appraisal ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {appraisal.metrics.map((m) => (
              <MetricCard key={m.key} m={m} editTargets={editTargets} onTarget={(v) => setTarget(m.key, v)} />
            ))}
          </div>

          {/* 6-month trend */}
          <div className={`${surface} mt-4 p-4`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">6-month trend</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-3">Month</th><th className="py-1 pr-3 text-right">Compliance</th>
                    <th className="py-1 pr-3 text-right">Breaches</th><th className="py-1 text-right">Recovery (AED)</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((t) => (
                    <tr key={t.month} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1 pr-3">{t.month}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{t.compliance}%</td>
                      <td className={`py-1 pr-3 text-right tabular-nums ${t.breaches > 0 ? "text-amber-600" : ""}`}>{t.breaches}</td>
                      <td className="py-1 text-right tabular-nums">
                        <span className="inline-block h-2 rounded bg-emerald-400 align-middle" style={{ width: `${Math.round((t.recovery / maxRecovery) * 60)}px` }} />
                        <span className="ml-2">{t.recovery.toLocaleString()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Manager rating + notes */}
          <div className={`${surface} mt-4 p-4`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Manager assessment ({month})</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-slate-600 dark:text-slate-300">Rating
                <select value={rating} onChange={(e) => setRating(e.target.value)} className={`${inputClass} ml-2 max-w-[120px]`}>
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                </select>
              </label>
              <button type="button" onClick={saveTheReview} className={btnPrimary}>Save assessment</button>
            </div>
            <textarea className={`${inputClass} mt-2 min-h-[70px]`} placeholder="Notes / strengths / areas to improve…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {/* Quality / error log */}
          <div className={`${surface} mt-4 p-4`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Quality / errors ({month})</p>
            {quality.length === 0 ? <p className="text-xs text-slate-400">No quality issues logged.</p> : (
              <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Date</th>
                      <th className="px-3 py-2 text-left font-semibold">Severity</th>
                      <th className="px-3 py-2 text-left font-semibold">Channel</th>
                      <th className="px-3 py-2 text-left font-semibold">Order / PO</th>
                      <th className="px-3 py-2 text-left font-semibold">Remarks</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {quality.map((q) => (
                      <tr key={q.id} className="align-top">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">{q.occurred_on}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${q.severity === "high" ? "bg-red-100 text-red-700" : q.severity === "low" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"}`}>{q.severity}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">{q.channel ?? q.category ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">{q.order_ref ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{q.description ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => deleteQuality(q.id).then(load)} className="text-[11px] text-slate-400 hover:text-red-600">remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Log an error</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Date of error</span>
                  <input type="date" className={`${inputClass} w-full`} value={qDate} onChange={(e) => setQDate(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Staff</span>
                  <select className={`${inputClass} w-full`} value={qStaff || userId} onChange={(e) => setQStaff(e.target.value)}>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Channel</span>
                  <select className={`${inputClass} w-full`} value={qChannel} onChange={(e) => setQChannel(e.target.value)}>
                    {QUALITY_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Severity</span>
                  <select className={`${inputClass} w-full`} value={qSev} onChange={(e) => setQSev(e.target.value)}>
                    <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Order no. / PO no.</span>
                  <input className={`${inputClass} w-full`} placeholder="e.g. S24162 / 403-… / PO-…" value={qOrder} onChange={(e) => setQOrder(e.target.value)} />
                </label>
                <label className="block sm:col-span-3">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Remarks</span>
                  <textarea className={`${inputClass} w-full`} rows={2} placeholder="What happened / how it was resolved" value={qDesc} onChange={(e) => setQDesc(e.target.value)} />
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={addQ} className={btnPrimary}>Log error</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AnalyticsContent({ profile }: { profile: UserProfile }) {
  const [tab, setTab] = useState<"business" | "appraisal">("business");
  return (
    <div>
      <PageHeader title="Analytics & Performance" subtitle="Business metrics and per-employee appraisal evidence." />
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setTab("business")} className={tab === "business" ? btnPrimary : btnSecondary}>Business</button>
        <button type="button" onClick={() => setTab("appraisal")} className={tab === "appraisal" ? btnPrimary : btnSecondary}>Appraisal</button>
      </div>
      {tab === "business" ? <ManagerScorecard profile={profile} /> : <AppraisalTab profile={profile} />}
    </div>
  );
}

export default function AnalyticsPage() {
  const { profile } = useAuth();
  return (
    <RouteGuard>
      <AppShell>
        {profile ? (
          isManager(profile) ? (
            <AnalyticsContent profile={profile} />
          ) : (
            <p className="p-6 text-sm text-slate-500">Analytics is available to managers only.</p>
          )
        ) : null}
      </AppShell>
    </RouteGuard>
  );
}
