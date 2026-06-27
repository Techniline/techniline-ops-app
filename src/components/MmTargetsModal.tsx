"use client";

import { useEffect, useState } from "react";

import { btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { formatAED } from "@/lib/format";
import {
  fetchMmTargetsForQuarter,
  quarterMonths,
  setMmTargetForMonth,
} from "@/lib/musicmajlis";

/** Manager-only: set a quarter's MusicMajlis sales target as three monthly
 *  amounts. The quarter total is auto-calculated. KPIs read these per-month
 *  (scorecard card) and summed (weekly grid). */
export function MmTargetsModal({
  year,
  quarter,
  createdBy,
  onClose,
  onSaved,
}: {
  year: number;
  quarter: number;
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const months = quarterMonths(year, quarter);
  const [values, setValues] = useState<Record<string, string>>({});
  const [splitInput, setSplitInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMmTargetsForQuarter(year, quarter).then((map) => {
      if (!alive) return;
      const v: Record<string, string> = {};
      for (const m of months) v[m.key] = map[m.key] != null ? String(map[m.key]) : "";
      setValues(v);
      setLoading(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, quarter]);

  // Quarter total is always the live sum of the three months (auto-calculated).
  const total = months.reduce((s, m) => s + (Number(values[m.key]) || 0), 0);

  function setMonth(key: string, raw: string) {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: raw }));
  }

  /** Optional shortcut: split a typed quarter total evenly across the 3 months. */
  function applySplit(raw: string) {
    setSplitInput(raw);
    const t = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(t) || t < 0) return;
    const each = Math.floor(t / 3);
    const next: Record<string, string> = {};
    months.forEach((m, i) => { next[m.key] = String(i === 2 ? t - each * 2 : each); });
    setSaved(false);
    setValues(next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const toSave = months
      .map((m) => ({ key: m.key, raw: (values[m.key] ?? "").trim() }))
      .filter((m) => m.raw !== "");
    if (toSave.length === 0) return setError("Enter at least one month's target.");
    for (const m of toSave) {
      const n = Number(m.raw);
      if (!Number.isFinite(n) || n < 0) return setError("Enter valid amounts (0 or more).");
    }
    setBusy(true);
    try {
      // Sequential so an error names the exact month that failed.
      for (const m of toSave) await setMmTargetForMonth(m.key, Number(m.raw), createdBy);
      setSaved(true);
      onSaved(); // refresh the scorecard behind the modal
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save targets.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Set MusicMajlis target — Q{quarter} {year}</h3>
        <p className="mb-4 mt-0.5 text-xs text-slate-500">Enter each month. The quarter total is calculated automatically. The scorecard card uses each month; the weekly grid uses the quarter total.</p>

        {loading ? (
          <div className="py-6 text-center text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            <div className="space-y-2">
              {months.map((m) => (
                <div key={m.key} className="flex items-center gap-3">
                  <span className="w-24 text-sm font-medium text-slate-600 dark:text-slate-300">{m.label}</span>
                  <input type="number" min="0" step="100" className={inputClass} placeholder="Target (AED)"
                    value={values[m.key] ?? ""} onChange={(e) => setMonth(m.key, e.target.value)} />
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Quarter total (auto)</span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100">{formatAED(total)}</span>
            </div>

            <details className="mt-3 text-xs text-slate-500">
              <summary className="cursor-pointer select-none">Shortcut: split a total evenly</summary>
              <input type="number" min="0" step="100" className={`${inputClass} mt-2`} placeholder="e.g. 220500 → 73,500 each"
                value={splitInput} onChange={(e) => applySplit(e.target.value)} />
            </details>
          </>
        )}

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
        {saved && !error ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">✓ Saved — {formatAED(total)} across {months.length} months.</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>{saved ? "Done" : "Cancel"}</button>
          <button type="submit" disabled={busy || loading} className={btnPrimary}>{busy ? "Saving…" : saved ? "Save again" : "Save targets"}</button>
        </div>
      </form>
    </div>
  );
}
