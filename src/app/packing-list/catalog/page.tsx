"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";
import type { SkuCatalogRow } from "@/lib/packing/types";

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

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

  const inp = "w-full rounded-xl border border-violet-100 bg-white px-3.5 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 placeholder:text-slate-300";
  const lbl = "block text-xs font-bold uppercase tracking-wider text-violet-400 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-violet-950/30 p-4 backdrop-blur-sm">
      <div
        style={{ boxShadow: "0 24px 64px rgba(109,40,217,0.18), 0 2px 8px rgba(0,0,0,0.08)" }}
        className="w-full max-w-2xl rounded-2xl bg-white"
      >
        <div className="flex items-center justify-between border-b border-violet-50 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-violet-400">
              {form.id ? "Editing" : "New entry"}
            </p>
            <h2 className="text-lg font-extrabold tracking-tight text-violet-900">
              {form.id ? form.model_no : "Add SKU"}
            </h2>
          </div>
          <button
            type="button" onClick={onClose}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 6px rgba(109,40,217,0.12)" }}
            className="rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm font-bold text-violet-400 hover:text-violet-600"
          >✕</button>
        </div>

        <form onSubmit={submit} className="grid grid-cols-2 gap-4 p-6">
          <div>
            <label className={lbl}>Model No *</label>
            <input className={inp} value={form.model_no ?? ""} onChange={(e) => set("model_no", e.target.value)} placeholder="e.g. AH-8031" />
          </div>
          <div>
            <label className={lbl}>Brand</label>
            <input className={inp} value={form.brand ?? ""} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. Ahuja" />
          </div>
          <div className="col-span-2">
            <label className={lbl}>Description</label>
            <input className={inp} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="Product description" />
          </div>
          <div>
            <label className={lbl}>HS Code</label>
            <input className={`${inp} font-mono`} value={form.hs_code ?? ""} onChange={(e) => set("hs_code", e.target.value)} placeholder="8518.21.00" />
          </div>
          <div>
            <label className={lbl}>Country of Origin</label>
            <input className={inp} value={form.country_of_origin ?? "China"} onChange={(e) => set("country_of_origin", e.target.value)} />
          </div>

          <div className="col-span-2 my-1 border-t border-violet-50" />

          <div>
            <label className={lbl}>Unit Weight (kg)</label>
            <input type="number" step="any" className={`${inp} font-mono`} value={form.unit_weight_kg ?? ""} onChange={(e) => set("unit_weight_kg", e.target.value ? Number(e.target.value) : null)} placeholder="0.00" />
          </div>
          <div>
            <label className={lbl}>Unit CBM (m³)</label>
            <input type="number" step="any" className={`${inp} font-mono`} value={form.unit_cbm ?? ""} onChange={(e) => set("unit_cbm", e.target.value ? Number(e.target.value) : null)} placeholder="0.00000" />
          </div>
          <div>
            <label className={lbl}>Units per Carton</label>
            <input type="number" step="1" className={`${inp} font-mono`} value={form.carton_qty ?? ""} onChange={(e) => set("carton_qty", e.target.value ? Number(e.target.value) : null)} placeholder="0" />
          </div>
          <div>
            <label className={lbl}>Carton Weight (kg)</label>
            <input type="number" step="any" className={`${inp} font-mono`} value={form.carton_weight_kg ?? ""} onChange={(e) => set("carton_weight_kg", e.target.value ? Number(e.target.value) : null)} placeholder="0.00" />
          </div>
          <div>
            <label className={lbl}>Carton CBM (m³)</label>
            <input type="number" step="any" className={`${inp} font-mono`} value={form.carton_cbm ?? ""} onChange={(e) => set("carton_cbm", e.target.value ? Number(e.target.value) : null)} placeholder="0.00000" />
          </div>
          <div>
            <label className={lbl}>Notes</label>
            <input className={inp} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes" />
          </div>

          {err && (
            <p className="col-span-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-600">{err}</p>
          )}

          <div className="col-span-2 flex justify-end gap-2.5 border-t border-violet-50 pt-4">
            <button
              type="button" onClick={onClose}
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 6px rgba(109,40,217,0.10)" }}
              className="rounded-xl border border-violet-100 bg-white px-5 py-2.5 text-sm font-bold text-violet-500 hover:border-violet-200"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 5px 18px rgba(124,58,237,0.45), 0 0 0 1px rgba(109,40,217,0.22)" }}
              className="rounded-xl bg-gradient-to-b from-violet-500 to-violet-700 px-6 py-2.5 text-sm font-bold text-white hover:from-violet-600 hover:to-violet-800 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save SKU"}
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

  // Stock List import
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
      if (q && !i.model_no.toLowerCase().includes(q) && !i.description?.toLowerCase().includes(q) && !i.brand?.toLowerCase().includes(q)) return false;
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
  const completeCount = items.filter(hasData).length;
  const missingCount = items.filter((i) => !hasData(i)).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-indigo-50 p-6 md:p-8">

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <Link
            href="/packing-list"
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-violet-400 hover:text-violet-600"
          >
            ← Packing Lists
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight text-violet-900">SKU Catalog</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-violet-100 bg-white px-3 py-1 text-xs font-semibold text-violet-600">
              {items.length.toLocaleString()} SKUs
            </span>
            <span
              style={{ boxShadow: "0 0 10px rgba(52,211,153,0.25)" }}
              className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700"
            >
              {completeCount.toLocaleString()} complete
            </span>
            {missingCount > 0 && (
              <span
                style={{ boxShadow: "0 0 10px rgba(251,191,36,0.28)" }}
                className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700"
              >
                {missingCount.toLocaleString()} need data
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Brand label for import */}
          <input
            className="w-28 rounded-xl border border-violet-100 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none placeholder:text-violet-300 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
            style={{ boxShadow: "inset 0 2px 5px rgba(109,40,217,0.06)" }}
            placeholder="Brand…"
            value={importBrand}
            onChange={(e) => setImportBrand(e.target.value)}
            title="Brand to apply when importing (if the file has no Brand column)"
          />
          <button
            type="button" onClick={() => importRef.current?.click()} disabled={importing}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 3px 10px rgba(16,185,129,0.18)" }}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-xs font-bold text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60"
          >
            {importing ? "⏳ Importing…" : "⬆ Import XLSX"}
          </button>
          <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />

          <button
            type="button" onClick={() => stockImportRef.current?.click()} disabled={stockImporting}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 3px 10px rgba(139,92,246,0.14)" }}
            className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-4 py-2 text-xs font-bold text-violet-700 hover:border-violet-300 hover:bg-violet-50 disabled:opacity-60"
            title="Upload Stock List to fill missing descriptions and brands"
          >
            {stockImporting ? "⏳ Matching…" : "📋 Stock List"}
          </button>
          <input ref={stockImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleStockImport} />

          <button
            type="button" onClick={load} disabled={loading}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 3px 10px rgba(139,92,246,0.10)" }}
            className="rounded-xl border border-violet-100 bg-white px-4 py-2 text-xs font-bold text-violet-400 hover:border-violet-200 hover:text-violet-600 disabled:opacity-50"
          >
            ↺ Refresh
          </button>

          <button
            type="button" onClick={() => setModal({})}
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 5px 18px rgba(124,58,237,0.50), 0 0 0 1px rgba(109,40,217,0.25)" }}
            className="rounded-xl bg-gradient-to-b from-violet-500 to-violet-700 px-5 py-2 text-sm font-bold text-white hover:from-violet-600 hover:to-violet-800"
          >
            + Add SKU
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div className="mb-5 flex flex-col gap-2">
        {importResult && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800" style={{ boxShadow: "0 2px 12px rgba(52,211,153,0.12)" }}>
            <span>
              Import complete — <strong>{importResult.inserted}</strong> inserted, <strong>{importResult.updated}</strong> updated
              {importResult.skipped > 0 && <>, <strong>{importResult.skipped}</strong> already complete</>}
              {importResult.errors > 0 && <>, <strong className="text-red-600">{importResult.errors}</strong> errors</>}
              {" "}(of {importResult.total} rows)
              {importResult.inserted === 0 && importResult.updated === 0 && importResult.skipped > 0 && (
                <span className="ml-2 font-medium text-emerald-600"> — all SKUs already had this data</span>
              )}
            </span>
            <button type="button" onClick={() => setImportResult(null)} className="ml-4 font-bold text-emerald-400 hover:text-emerald-600">✕</button>
          </div>
        )}
        {importErr && (
          <div className="flex items-center justify-between rounded-xl border border-red-100 bg-white px-4 py-3 text-sm text-red-600" style={{ boxShadow: "0 2px 12px rgba(239,68,68,0.08)" }}>
            <span>Import failed: {importErr}</span>
            <button type="button" onClick={() => setImportErr(null)} className="ml-4 font-bold text-red-400 hover:text-red-600">✕</button>
          </div>
        )}
        {stockResult && (
          <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm text-violet-800" style={{ boxShadow: "0 2px 12px rgba(139,92,246,0.10)" }}>
            <span>
              Stock List matched — <strong>{stockResult.updated}</strong> descriptions/brands filled
              {stockResult.errors > 0 && <>, <strong className="text-red-600">{stockResult.errors}</strong> errors</>}
              {" "}(<strong>{stockResult.matched}</strong> of {stockResult.total} catalog SKUs matched)
            </span>
            <button type="button" onClick={() => setStockResult(null)} className="ml-4 font-bold text-violet-400 hover:text-violet-600">✕</button>
          </div>
        )}
        {stockErr && (
          <div className="flex items-center justify-between rounded-xl border border-red-100 bg-white px-4 py-3 text-sm text-red-600" style={{ boxShadow: "0 2px 12px rgba(239,68,68,0.08)" }}>
            <span>Stock List failed: {stockErr}</span>
            <button type="button" onClick={() => setStockErr(null)} className="ml-4 font-bold text-red-400 hover:text-red-600">✕</button>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-100 bg-white px-4 py-3 text-sm text-red-600" style={{ boxShadow: "0 2px 12px rgba(239,68,68,0.08)" }}>
            {error}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-violet-300">⌕</span>
          <input
            type="search"
            placeholder="Search model, brand or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ boxShadow: "inset 0 2px 5px rgba(109,40,217,0.07), 0 1px 2px rgba(0,0,0,0.04)" }}
            className="w-80 rounded-xl border border-violet-100 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          />
        </div>

        <div
          style={{ boxShadow: "inset 0 1px 4px rgba(109,40,217,0.07), 0 1px 2px rgba(0,0,0,0.04)" }}
          className="flex items-center gap-1 rounded-xl border border-violet-100 bg-white p-1"
        >
          {brands.slice(0, 8).map((b) => (
            <button
              key={b} type="button" onClick={() => setBrandFilter(b)}
              style={brandFilter === b ? { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 3px 10px rgba(124,58,237,0.40)" } : {}}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                brandFilter === b
                  ? "bg-gradient-to-b from-violet-500 to-violet-700 text-white"
                  : "text-slate-400 hover:text-violet-600"
              }`}
            >
              {b}
            </button>
          ))}
          {brands.length > 9 && (
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="rounded-lg border-0 bg-transparent py-1.5 pl-2 pr-6 text-xs font-bold text-slate-400 outline-none hover:text-violet-600"
            >
              {brands.slice(8).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </div>

        {!loading && (
          <span className="text-xs font-semibold text-violet-300">{filtered.length.toLocaleString()} of {items.length.toLocaleString()}</span>
        )}
      </div>

      {/* Skeleton */}
      {loading && (
        <div className="space-y-2.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-violet-100/60" />
          ))}
        </div>
      )}

      {/* Table */}
      {!loading && (
        <div
          style={{ boxShadow: "0 8px 32px rgba(139,92,246,0.12), 0 2px 6px rgba(0,0,0,0.04)" }}
          className="overflow-hidden rounded-2xl border border-violet-100 bg-white"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr className="border-b border-violet-50 bg-gradient-to-r from-violet-50/80 to-purple-50/80">
                  <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Model No</th>
                  <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Brand</th>
                  <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Description</th>
                  <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">Country</th>
                  <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-widest text-violet-400">HS Code</th>
                  <th className="px-5 py-4 text-right text-xs font-black uppercase tracking-widest text-violet-400">Unit Wt</th>
                  <th className="px-5 py-4 text-right text-xs font-black uppercase tracking-widest text-violet-400">Unit CBM</th>
                  <th className="px-5 py-4 text-right text-xs font-black uppercase tracking-widest text-violet-400">Ctn Qty</th>
                  <th className="px-5 py-4 text-right text-xs font-black uppercase tracking-widest text-violet-400">Ctn CBM</th>
                  <th className="px-5 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-50">
                {filtered.map((item) => {
                  const complete = !!hasData(item);
                  return (
                    <tr
                      key={item.id}
                      className="group bg-white transition-colors hover:bg-violet-50/30"
                      style={{ borderLeft: `3px solid ${complete ? "#10b981" : "#fbbf24"}` }}
                    >
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs font-bold text-violet-600">{item.model_no}</span>
                      </td>
                      <td className="px-5 py-3">
                        {item.brand
                          ? <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-bold text-violet-700">{item.brand}</span>
                          : <span className="text-xs text-slate-200">—</span>}
                      </td>
                      <td className="max-w-xs px-5 py-3">
                        <span className={`block truncate text-sm ${item.description ? "text-slate-700" : "text-slate-200"}`}>
                          {item.description ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{item.country_of_origin}</td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-slate-400">{item.hs_code ?? <span className="text-slate-200">—</span>}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-xs">
                        {item.unit_weight_kg != null
                          ? <span className="font-mono text-slate-700">{item.unit_weight_kg}</span>
                          : <span className="font-bold text-amber-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-xs">
                        {item.unit_cbm != null
                          ? <span className="font-mono text-slate-700">{item.unit_cbm}</span>
                          : <span className="font-bold text-amber-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-xs font-mono text-slate-500">{item.carton_qty ?? <span className="text-slate-200">—</span>}</td>
                      <td className="px-5 py-3 text-right text-xs font-mono text-slate-500">{item.carton_cbm ?? <span className="text-slate-200">—</span>}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button" onClick={() => setModal(item)}
                            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 6px rgba(109,40,217,0.12)" }}
                            className="rounded-lg border border-violet-100 bg-white px-3 py-1.5 text-xs font-bold text-violet-600 hover:border-violet-200 hover:shadow-md"
                          >
                            Edit
                          </button>
                          <button
                            type="button" onClick={() => handleDelete(item.id)} disabled={deleting === item.id}
                            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85), 0 2px 6px rgba(239,68,68,0.10)" }}
                            className="rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-100 disabled:opacity-40"
                          >
                            {deleting === item.id ? "…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-16 text-center">
                      <p className="text-sm font-medium text-violet-300">
                        {items.length === 0 ? "No SKUs in catalog yet." : "No SKUs match your filters."}
                      </p>
                      {items.length === 0 && (
                        <button
                          type="button" onClick={() => setModal({})}
                          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 5px 18px rgba(124,58,237,0.45)" }}
                          className="mt-4 rounded-xl bg-gradient-to-b from-violet-500 to-violet-700 px-6 py-2.5 text-sm font-bold text-white"
                        >
                          Add your first SKU →
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <SkuForm initial={modal} onClose={() => setModal(null)} onSave={handleSave} />
      )}
    </div>
  );
}
