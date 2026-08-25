"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabaseClient";
import type { SkuCatalogRow } from "@/lib/packing/types";

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}
import Link from "next/link";

function SkuForm({
  initial,
  onSave,
  onClose,
}: {
  initial: Partial<SkuCatalogRow>;
  onSave: (item: SkuCatalogRow) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<SkuCatalogRow>>({ country_of_origin: "China", ...initial });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof SkuCatalogRow, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.model_no?.trim()) { setErr("Model No is required."); return; }
    setSaving(true); setErr(null);
    try {
      const token = await getToken();
      const method = form.id ? "PUT" : "POST";
      const url = form.id ? `/api/packing/catalog/${form.id}` : "/api/packing/catalog";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { ok: boolean; item?: SkuCatalogRow; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed");
      onSave(json.item!);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed.");
    } finally { setSaving(false); }
  }

  const inp = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const lbl = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {form.id ? "Edit SKU" : "Add SKU"}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4 p-6">
          <div><label className={lbl}>Model No *</label><input className={inp} value={form.model_no ?? ""} onChange={(e) => set("model_no", e.target.value)} /></div>
          <div><label className={lbl}>Brand</label><input className={inp} value={form.brand ?? ""} onChange={(e) => set("brand", e.target.value)} /></div>
          <div className="col-span-2"><label className={lbl}>Description</label><input className={inp} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} /></div>
          <div><label className={lbl}>HS Code</label><input className={inp} value={form.hs_code ?? ""} onChange={(e) => set("hs_code", e.target.value)} /></div>
          <div><label className={lbl}>Country of Origin</label><input className={inp} value={form.country_of_origin ?? "China"} onChange={(e) => set("country_of_origin", e.target.value)} /></div>
          <div><label className={lbl}>Unit Weight (kg)</label><input type="number" step="any" className={inp} value={form.unit_weight_kg ?? ""} onChange={(e) => set("unit_weight_kg", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className={lbl}>Unit CBM (m³)</label><input type="number" step="any" className={inp} value={form.unit_cbm ?? ""} onChange={(e) => set("unit_cbm", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className={lbl}>Units per Carton</label><input type="number" step="1" className={inp} value={form.carton_qty ?? ""} onChange={(e) => set("carton_qty", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className={lbl}>Carton Weight (kg)</label><input type="number" step="any" className={inp} value={form.carton_weight_kg ?? ""} onChange={(e) => set("carton_weight_kg", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className={lbl}>Carton CBM (m³)</label><input type="number" step="any" className={inp} value={form.carton_cbm ?? ""} onChange={(e) => set("carton_cbm", e.target.value ? Number(e.target.value) : null)} /></div>
          <div><label className={lbl}>Notes</label><input className={inp} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>
          {err && <p className="col-span-2 text-xs text-red-600">{err}</p>}
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PackingCatalogPage() {
  const [items, setItems] = useState<SkuCatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("All");
  const [modal, setModal] = useState<Partial<SkuCatalogRow> | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Bulk import
  const importRef = useRef<HTMLInputElement>(null);
  const [importBrand, setImportBrand] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; skipped: number; errors: number; total: number } | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  // Stock List import (description/brand fill)
  const stockImportRef = useRef<HTMLInputElement>(null);
  const [stockImporting, setStockImporting] = useState(false);
  const [stockResult, setStockResult] = useState<{ total: number; matched: number; updated: number; errors: number } | null>(null);
  const [stockErr, setStockErr] = useState<string | null>(null);

  async function handleStockImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStockImporting(true); setStockResult(null); setStockErr(null);
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/packing/catalog/stock-import", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const json = await res.json() as { ok: boolean; total?: number; matched?: number; updated?: number; errors?: number; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Import failed");
      setStockResult({ total: json.total ?? 0, matched: json.matched ?? 0, updated: json.updated ?? 0, errors: json.errors ?? 0 });
      void load();
    } catch (err) { setStockErr(err instanceof Error ? err.message : "Import failed"); }
    finally { setStockImporting(false); }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true); setImportResult(null); setImportErr(null);
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("brand", importBrand.trim());
      const res = await fetch("/api/packing/catalog/bulk-import", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const json = await res.json() as { ok: boolean; inserted?: number; updated?: number; skipped?: number; errors?: number; total?: number; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Import failed");
      setImportResult({ inserted: json.inserted ?? 0, updated: json.updated ?? 0, skipped: json.skipped ?? 0, errors: json.errors ?? 0, total: json.total ?? 0 });
      void load();
    } catch (err) { setImportErr(err instanceof Error ? err.message : "Import failed"); }
    finally { setImporting(false); }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/packing/catalog", { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json()) as { ok: boolean; items?: SkuCatalogRow[]; error?: string };
      if (!json.ok) throw new Error(json.error);
      setItems(json.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Load failed."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const brands = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.brand ?? "").filter(Boolean))).sort()], [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (q && !i.model_no.toLowerCase().includes(q) && !i.description?.toLowerCase().includes(q)) return false;
      if (brandFilter !== "All" && i.brand !== brandFilter) return false;
      return true;
    });
  }, [items, search, brandFilter]);

  async function handleDelete(id: string) {
    if (!confirm("Remove this SKU from catalog?")) return;
    setDeleting(id);
    const token = await getToken();
    try {
      await fetch(`/api/packing/catalog/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      setItems((p) => p.filter((i) => i.id !== id));
    } finally { setDeleting(null); }
  }

  function handleSave(item: SkuCatalogRow) {
    setItems((p) => {
      const idx = p.findIndex((i) => i.id === item.id);
      if (idx >= 0) { const next = [...p]; next[idx] = item; return next; }
      return [item, ...p];
    });
    setModal(null);
  }

  const hasData = (i: SkuCatalogRow) => i.unit_weight_kg && i.unit_cbm;

  const inputCls = "rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/packing-list" className="text-sm text-slate-500 hover:text-slate-700">← Packing Lists</Link>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">SKU Catalog</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Bulk import */}
          <input
            className={`w-32 ${inputCls} text-xs`}
            placeholder="Brand (optional)"
            value={importBrand}
            onChange={(e) => setImportBrand(e.target.value)}
            title="Brand name to apply to all rows in the imported file (if the file doesn't have a Brand column)"
          />
          <button type="button" onClick={() => importRef.current?.click()} disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
            {importing ? "⏳ Importing…" : "⬆ Import XLSX / CSV"}
          </button>
          <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
          <button type="button" onClick={() => stockImportRef.current?.click()} disabled={stockImporting}
            className="flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-400"
            title="Upload Stock List xlsx to fill in missing descriptions and brands by matching ItemCode to catalog Model No">
            {stockImporting ? "⏳ Matching…" : "📋 Stock List"}
          </button>
          <input ref={stockImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleStockImport} />
          <button type="button" onClick={load} disabled={loading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 disabled:opacity-50">
            Refresh
          </button>
          <button type="button" onClick={() => setModal({})}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            + Add SKU
          </button>
        </div>
      </div>

      {/* Import result / error */}
      {importResult && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
          <span>
            Import complete — <strong>{importResult.inserted}</strong> inserted, <strong>{importResult.updated}</strong> updated
            {importResult.skipped > 0 && <>, <strong>{importResult.skipped}</strong> already complete</>}
            {importResult.errors > 0 && <>, <strong className="text-red-600">{importResult.errors}</strong> errors</>}
            {" "}(of {importResult.total} rows)
            {importResult.inserted === 0 && importResult.updated === 0 && importResult.skipped > 0 && (
              <span className="ml-2 text-emerald-600"> — all SKUs already had this data</span>
            )}
          </span>
          <button type="button" onClick={() => setImportResult(null)} className="ml-4 text-emerald-600 hover:text-emerald-800">✕</button>
        </div>
      )}
      {importErr && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>Import failed: {importErr}</span>
          <button type="button" onClick={() => setImportErr(null)} className="ml-4 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      {stockResult && (
        <div className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-800 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
          <span>
            Stock List match — <strong>{stockResult.updated}</strong> descriptions/brands filled
            {stockResult.errors > 0 && <>, <strong className="text-red-600">{stockResult.errors}</strong> errors</>}
            {" "}(<strong>{stockResult.matched}</strong> matched of {stockResult.total} catalog SKUs)
          </span>
          <button type="button" onClick={() => setStockResult(null)} className="ml-4 text-violet-500 hover:text-violet-700">✕</button>
        </div>
      )}
      {stockErr && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>Stock List import failed: {stockErr}</span>
          <button type="button" onClick={() => setStockErr(null)} className="ml-4 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-4 text-xs text-slate-500">
        <span>{items.length} total SKUs</span>
        <span className="text-emerald-600">{items.filter(hasData).length} with full data</span>
        <span className="text-amber-600">{items.filter((i) => !hasData(i)).length} need data</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" placeholder="Search model or description…" value={search} onChange={(e) => setSearch(e.target.value)} className={`w-72 ${inputCls}`} />
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className={inputCls}>
          {brands.map((b) => <option key={b}>{b}</option>)}
        </select>
        {!loading && <span className="text-xs text-slate-400">{filtered.length} shown</span>}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}</div>
      )}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                <th className="px-4 py-3 text-left">Model No</th>
                <th className="px-4 py-3 text-left">Brand</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-left">Country</th>
                <th className="px-4 py-3 text-left">HS Code</th>
                <th className="px-4 py-3 text-right">Unit Wt (kg)</th>
                <th className="px-4 py-3 text-right">Unit CBM</th>
                <th className="px-4 py-3 text-right">Ctn Qty</th>
                <th className="px-4 py-3 text-right">Ctn CBM</th>
                <th className="px-4 py-3 text-center">Data</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((item) => (
                <tr key={item.id} className="bg-white transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-indigo-600">{item.model_no}</td>
                  <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{item.brand ?? "—"}</td>
                  <td className="px-4 py-2.5 max-w-xs text-slate-600 dark:text-slate-400 truncate">{item.description ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{item.country_of_origin}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{item.hs_code ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{item.unit_weight_kg ?? <span className="text-amber-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{item.unit_cbm ?? <span className="text-amber-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{item.carton_qty ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{item.carton_cbm ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${hasData(item) ? "bg-emerald-500" : "bg-amber-400"}`} title={hasData(item) ? "Complete" : "Missing weight or CBM"} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setModal(item)}
                        className="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50">Edit</button>
                      <button type="button" onClick={() => handleDelete(item.id)} disabled={deleting === item.id}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50">
                        {deleting === item.id ? "…" : "Del"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-sm text-slate-400">No SKUs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <SkuForm initial={modal} onClose={() => setModal(null)} onSave={handleSave} />
      )}
    </div>
  );
}
