"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { deleteSkuCost, fetchSkuCosts, saveSkuCosts, type SkuCostInput } from "@/lib/spapi/seller";

interface EditRow {
  seller_sku: string;
  expected: string;
  isNew?: boolean;
}

/** Parse a CSV/XLSX into {sku, expected_in_hand}. Tolerant of column names:
 *  SKU/seller; expected|in hand|target|net|hand. */
async function parseFile(file: File): Promise<SkuCostInput[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  if (rows.length < 2) return [];
  const headers = (rows[0] as unknown[]).map((h) => String(h ?? "").trim().toLowerCase());
  const iSku = headers.findIndex((h) => /sku|seller/.test(h));
  const iExp = headers.findIndex((h) => /expect|in.?hand|hand|target|net/.test(h));
  if (iSku < 0) throw new Error("Couldn't find a SKU column. Add a header named 'SKU'.");
  if (iExp < 0) throw new Error("Couldn't find an expected-amount column. Name it 'Expected in hand' (or 'Target').");
  const num = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const out: SkuCostInput[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const sku = String(row[iSku] ?? "").trim();
    if (!sku) continue;
    out.push({ seller_sku: sku, expected_in_hand: num(row[iExp]) });
  }
  return out;
}

export function SkuCostsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [list, setList] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    const map = await fetchSkuCosts();
    setList([...map.values()].map((r) => ({ seller_sku: r.seller_sku, expected: r.expected_in_hand != null ? String(r.expected_in_hand) : "" })));
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? list.filter((r) => r.seller_sku.toLowerCase().includes(q)) : list;
  }, [list, search]);

  function setCell(sku: string, key: keyof EditRow, val: string) {
    setList((rows) => rows.map((r) => (r.seller_sku === sku ? { ...r, [key]: val } : r)));
  }

  async function importFile(file: File) {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) throw new Error("No rows found. Need columns: SKU, Expected in hand.");
      const n = await saveSkuCosts(rows);
      setMsg(`Imported ${n} SKU${n === 1 ? "" : "s"}.`);
      await reload(); onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed.");
    } finally { setBusy(false); }
  }

  async function saveAll() {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const rows: SkuCostInput[] = list
        .filter((r) => r.seller_sku.trim() !== "")
        .map((r) => ({ seller_sku: r.seller_sku.trim(), expected_in_hand: r.expected.trim() === "" ? null : Number(r.expected) }));
      const n = await saveSkuCosts(rows);
      setMsg(`Saved ${n} SKU${n === 1 ? "" : "s"}.`);
      await reload(); onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally { setBusy(false); }
  }

  async function removeRow(sku: string, isNew?: boolean) {
    if (isNew) { setList((rows) => rows.filter((r) => r.seller_sku !== sku)); return; }
    setBusy(true);
    try { await deleteSkuCost(sku); await reload(); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Delete failed."); }
    finally { setBusy(false); }
  }

  function addRow() {
    setList((rows) => [{ seller_sku: "", expected: "", isNew: true }, ...rows]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Expected in‑hand (per SKU)</h3>
            <p className="mt-0.5 text-xs text-slate-500">The net amount you want to receive per unit <strong>after all Amazon deductions</strong>. The module flags any order where the actual net received falls below this.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
          <label className={`${btnSecondary} cursor-pointer`}>
            ⬆ Import CSV/Excel
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          </label>
          <span className="text-[11px] text-slate-400">Columns: <strong>SKU</strong>, <strong>Expected in hand</strong></span>
          <button type="button" onClick={addRow} disabled={busy} className={`${btnSecondary} ml-auto`}>+ Add SKU</button>
        </div>

        <input className={`${inputClass} mb-2`} placeholder="Search SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />

        {err ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{err}</p> : null}
        {msg ? <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{msg}</p> : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
              <tr className="text-left text-slate-500">
                <th className="px-2 py-1.5 font-medium">SKU</th>
                <th className="px-2 py-1.5 text-right font-medium">Expected in‑hand (AED)</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="px-2 py-6 text-center text-slate-400">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={3} className="px-2 py-6 text-center text-slate-400">No SKUs yet — import a spreadsheet or add one.</td></tr>
              ) : shown.map((r) => (
                <tr key={r.seller_sku || "new"} className="border-t border-slate-200/70 dark:border-slate-800">
                  <td className="px-2 py-1">
                    {r.isNew
                      ? <input className={`${inputClass} !py-1`} placeholder="SKU" value={r.seller_sku} onChange={(e) => setCell(r.seller_sku, "seller_sku", e.target.value)} />
                      : <span className="font-medium">{r.seller_sku}</span>}
                  </td>
                  <td className="px-2 py-1"><input type="number" step="0.01" className={`${inputClass} !py-1 text-right`} value={r.expected} onChange={(e) => setCell(r.seller_sku, "expected", e.target.value)} /></td>
                  <td className="px-2 py-1 text-right"><button type="button" onClick={() => void removeRow(r.seller_sku, r.isNew)} className="text-slate-400 hover:text-rose-600" title="Delete">🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
          <button type="button" onClick={() => void saveAll()} disabled={busy || loading} className={btnPrimary}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
