"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  COMPANY_INFO, computePhysical, aedToWords,
  type PackingCompany, type PackingLine, type PackingMode, type SkuCatalogRow,
} from "@/lib/packing/types";
import type { ParsedItem } from "@/app/api/packing/parse-document/route";

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

const TODAY = new Date().toISOString().slice(0, 10);

function newLine(): PackingLine {
  return {
    key: Math.random().toString(36).slice(2),
    model_no: "", brand: "", description: "", hs_code: "", country_of_origin: "China",
    qty: 1, no_of_ctns: 1, tot_cbm: 0, total_weight_kg: 0, unit_price: 0, amount: 0,
    box_no: 0,
    _sku_id: null, _unit_weight_kg: null, _unit_cbm: null, _carton_qty: null,
    _carton_weight_kg: null, _carton_cbm: null,
  };
}

function fmt2(n: number) {
  return n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt5(n: number) {
  return n.toFixed(5).replace(/\.?0+$/, "");
}

interface BoxMeta { ctns: number; }

const BOX_COLOURS = [
  { row: "bg-sky-50/60 border-l-2 border-l-sky-400 dark:bg-sky-950/30", badge: "bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:border-sky-700", dot: "bg-sky-400" },
  { row: "bg-violet-50/60 border-l-2 border-l-violet-400 dark:bg-violet-950/30", badge: "bg-violet-100 text-violet-700 border border-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:border-violet-700", dot: "bg-violet-400" },
  { row: "bg-amber-50/60 border-l-2 border-l-amber-400 dark:bg-amber-950/30", badge: "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700", dot: "bg-amber-400" },
  { row: "bg-emerald-50/60 border-l-2 border-l-emerald-400 dark:bg-emerald-950/30", badge: "bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-700", dot: "bg-emerald-400" },
  { row: "bg-rose-50/60 border-l-2 border-l-rose-400 dark:bg-rose-950/30", badge: "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/50 dark:text-rose-300 dark:border-rose-700", dot: "bg-rose-400" },
  { row: "bg-orange-50/60 border-l-2 border-l-orange-400 dark:bg-orange-950/30", badge: "bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700", dot: "bg-orange-400" },
];

function getBoxColour(boxNo: number) {
  if (boxNo === 0) return null;
  return BOX_COLOURS[(boxNo - 1) % BOX_COLOURS.length];
}

// ─── SKU Modal ────────────────────────────────────────────────────────────────
function SkuModal({ initial, onSave, onClose }: { initial: Partial<SkuCatalogRow>; onSave: (s: SkuCatalogRow) => void; onClose: () => void }) {
  const [form, setForm] = useState<Partial<SkuCatalogRow>>(initial);
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
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(form) });
      const json = await res.json() as { ok: boolean; item?: SkuCatalogRow; error?: string };
      if (!json.ok) throw new Error(json.error);
      onSave(json.item!);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Save failed."); }
    finally { setSaving(false); }
  }

  const inp = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const lbl = "block text-xs font-medium text-slate-500 mb-1";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{form.id ? "Edit SKU" : "Add SKU to Catalog"}</h2>
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
            <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Saving…" : "Save to Catalog"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Import Preview Modal ─────────────────────────────────────────────────────
function ImportPreviewModal({ items, onConfirm, onClose }: { items: ParsedItem[]; onConfirm: (sel: ParsedItem[]) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set(items.map((_, i) => i)));
  const toggle = (i: number) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900" style={{ maxHeight: "80vh" }}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div><h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Import {items.length} line items</h2>
            <p className="text-xs text-slate-400">Deselect items you don&apos;t want to import.</p></div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2 text-left">Model No</th>
                <th className="px-4 py-2 text-left">Brand</th>
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Unit Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item, i) => (
                <tr key={i} className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 ${!selected.has(i) ? "opacity-40" : ""}`} onClick={() => toggle(i)}>
                  <td className="px-4 py-2"><input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="px-4 py-2 font-mono text-xs text-indigo-600">{item.model_no}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{item.brand}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs max-w-xs truncate">{item.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{item.qty}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{item.unit_price > 0 ? fmt2(item.unit_price) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-700">
          <span className="text-xs text-slate-400">{selected.size} of {items.length} selected</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700">Cancel</button>
            <button type="button" disabled={selected.size === 0} onClick={() => onConfirm(items.filter((_, i) => selected.has(i)))}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              Import {selected.size} item{selected.size !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Builder ─────────────────────────────────────────────────────────────
export default function PackingListBuilder({ editId }: { editId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [company, setCompany] = useState<PackingCompany>("techniline");
  const [mode, setMode] = useState<PackingMode>("physical");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [listDate, setListDate] = useState(TODAY);
  const [consigneeName, setConsigneeName] = useState("");
  const [consigneeAddress, setConsigneeAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [shippingLabel, setShippingLabel] = useState("");
  const [lines, setLines] = useState<PackingLine[]>([newLine()]);

  // Box assignment
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [boxData, setBoxData] = useState<Record<number, BoxMeta>>({});
  const [manualBoxNo, setManualBoxNo] = useState("");

  // SKU autocomplete
  const [suggestions, setSuggestions] = useState<SkuCatalogRow[]>([]);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [skuModal, setSkuModal] = useState<{ initial: Partial<SkuCatalogRow>; lineKey: string } | null>(null);
  const suggestRef = useRef<NodeJS.Timeout | null>(null);

  // Brand autocomplete
  const [allBrands, setAllBrands] = useState<string[]>([]);
  const [brandSuggestKey, setBrandSuggestKey] = useState<string | null>(null);
  const [brandQuery, setBrandQuery] = useState("");

  useEffect(() => {
    getToken().then((token) =>
      fetch("/api/packing/catalog?brands=1", { headers: { Authorization: `Bearer ${token}` } })
    ).then((r) => r.json()).then((j: { ok: boolean; brands?: string[] }) => {
      if (j.ok && j.brands) setAllBrands(j.brands);
    }).catch(() => {});
  }, []);

  // PDF import
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{ customer_name: string; doc_no: string; doc_date: string; items: ParsedItem[] } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Inline catalog field edits — tracks which line keys have unsaved changes
  const [catalogDirty, setCatalogDirty] = useState<Record<string, Set<string>>>({});
  const [catalogSaving, setCatalogSaving] = useState<Set<string>>(new Set());
  const [catalogSaveErr, setCatalogSaveErr] = useState<Record<string, string>>({});

  async function saveCatalogFields(lineKey: string) {
    const ln = lines.find((l) => l.key === lineKey);
    if (!ln?._sku_id) return;
    const dirty = catalogDirty[lineKey];
    if (!dirty?.size) return;
    setCatalogSaving((prev) => new Set([...prev, lineKey]));
    setCatalogSaveErr((prev) => { const n = { ...prev }; delete n[lineKey]; return n; });
    try {
      const token = await getToken();
      const patch: Record<string, unknown> = {};
      if (dirty.has("carton_qty")) patch.carton_qty = ln._carton_qty;
      if (dirty.has("hs_code")) patch.hs_code = ln.hs_code || null;
      const res = await fetch(`/api/packing/catalog/${ln._sku_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Save failed");
      setCatalogDirty((prev) => { const n = { ...prev }; delete n[lineKey]; return n; });
    } catch (e) {
      setCatalogSaveErr((prev) => ({ ...prev, [lineKey]: e instanceof Error ? e.message : "Save failed" }));
    } finally {
      setCatalogSaving((prev) => { const n = new Set(prev); n.delete(lineKey); return n; });
    }
  }

  function markCatalogDirty(lineKey: string, field: string) {
    setCatalogDirty((prev) => ({
      ...prev,
      [lineKey]: new Set([...(prev[lineKey] ?? []), field]),
    }));
  }

  // Per-user draft persistence
  const [userId, setUserId] = useState<string | null>(null);
  const draftLoadedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
  }, []);

  function draftKey(uid: string) {
    const id = editId ?? searchParams.get("edit");
    return id ? `packing-draft-edit-${id}-${uid}` : `packing-draft-new-${uid}`;
  }

  // Restore draft on mount for new lists (only once, after userId is known)
  useEffect(() => {
    if (!userId || draftLoadedRef.current) return;
    const id = editId ?? searchParams.get("edit");
    if (id) return; // editing an existing list — load from server, not localStorage
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as { company?: PackingCompany; mode?: PackingMode; invoiceNo?: string; listDate?: string; consigneeName?: string; consigneeAddress?: string; notes?: string; shippingLabel?: string; lines?: PackingLine[]; boxData?: Record<number, BoxMeta> };
      if (d.company) setCompany(d.company);
      if (d.mode) setMode(d.mode);
      if (d.invoiceNo != null) setInvoiceNo(d.invoiceNo);
      if (d.listDate) setListDate(d.listDate);
      if (d.consigneeName != null) setConsigneeName(d.consigneeName);
      if (d.consigneeAddress != null) setConsigneeAddress(d.consigneeAddress);
      if (d.notes != null) setNotes(d.notes);
      if (d.shippingLabel != null) setShippingLabel(d.shippingLabel);
      if (d.lines?.length) setLines(d.lines);
      if (d.boxData) setBoxData(d.boxData);
    } catch { /* corrupt draft — ignore */ }
    draftLoadedRef.current = true;
  }, [userId, editId, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft whenever any form state changes
  useEffect(() => {
    if (!userId) return;
    const payload = JSON.stringify({ company, mode, invoiceNo, listDate, consigneeName, consigneeAddress, notes, shippingLabel, lines, boxData });
    try { localStorage.setItem(draftKey(userId), payload); } catch { /* storage full */ }
  }, [userId, company, mode, invoiceNo, listDate, consigneeName, consigneeAddress, notes, shippingLabel, lines, boxData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing list
  useEffect(() => {
    const id = editId ?? searchParams.get("edit");
    if (!id) return;
    (async () => {
      try {
        const token = await getToken();
        const [listJson, catJson] = await Promise.all([
          fetch(`/api/packing/lists/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
          fetch("/api/packing/catalog", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
        ]);
        if (!listJson.ok) return;

        // Build a catalog lookup by model_no so we can restore _* fields on each line
        const catalogMap = new Map<string, SkuCatalogRow>();
        if (catJson.ok && catJson.items) {
          for (const sku of catJson.items as SkuCatalogRow[]) {
            catalogMap.set(sku.model_no.toLowerCase(), sku);
          }
        }

        const l = listJson.list;
        setCompany(l.company); setMode(l.mode);
        setInvoiceNo(l.invoice_no ?? ""); setListDate(l.list_date ?? TODAY);
        setConsigneeName(l.consignee_name ?? ""); setConsigneeAddress(l.consignee_address ?? "");
        setNotes(l.notes ?? ""); setShippingLabel(l.shipping_label ?? "");

        // Reconstruct boxData: for each box_no > 0, sum no_of_ctns of primary row only
        const newBoxData: Record<number, BoxMeta> = {};
        for (const item of listJson.items as Array<PackingLine & { box_no: number | null; no_of_ctns: number }>) {
          const b = item.box_no ?? 0;
          if (b === 0) continue;
          if (!newBoxData[b]) newBoxData[b] = { ctns: 0 };
          newBoxData[b].ctns += item.no_of_ctns ?? 0;
        }
        setBoxData(newBoxData);

        setLines((listJson.items as PackingLine[]).map((item) => {
          const sku = catalogMap.get(item.model_no?.toLowerCase() ?? "");
          return {
            ...newLine(),
            ...item,
            key: Math.random().toString(36).slice(2),
            box_no: (item.box_no as unknown as number | null) ?? 0,
            // Re-link catalog metadata so Pcs/Ctn, weight and CBM recalculate correctly
            _sku_id: sku?.id ?? null,
            _unit_weight_kg: sku?.unit_weight_kg ?? null,
            _unit_cbm: sku?.unit_cbm ?? null,
            _carton_qty: sku?.carton_qty ?? null,
            _carton_weight_kg: sku?.carton_weight_kg ?? null,
            _carton_cbm: sku?.carton_cbm ?? null,
          };
        }));
      } catch { /* ignore */ }
    })();
  }, [editId, searchParams]);

  // SKU search
  const searchSku = useCallback((q: string, lineKey: string) => {
    setActiveLineKey(lineKey);
    if (suggestRef.current) clearTimeout(suggestRef.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestRef.current = setTimeout(async () => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/packing/catalog?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json() as { ok: boolean; items: SkuCatalogRow[] };
        if (json.ok) setSuggestions(json.items.slice(0, 10));
      } catch { /* ignore */ }
    }, 220);
  }, []);

  function applySku(sku: SkuCatalogRow, lineKey: string) {
    setSuggestions([]);
    setLines((prev) => prev.map((ln) => {
      if (ln.key !== lineKey) return ln;
      const phys = computePhysical(ln.qty, sku);
      return {
        ...ln, model_no: sku.model_no, brand: sku.brand ?? "", description: sku.description ?? "",
        hs_code: sku.hs_code ?? "", country_of_origin: sku.country_of_origin,
        ...phys, amount: ln.qty * ln.unit_price,
        _sku_id: sku.id,
        _unit_weight_kg: sku.unit_weight_kg, _unit_cbm: sku.unit_cbm,
        _carton_qty: sku.carton_qty, _carton_weight_kg: sku.carton_weight_kg, _carton_cbm: sku.carton_cbm,
      };
    }));
    // Clear any pending catalog saves for this line since we just reloaded from catalog
    setCatalogDirty((prev) => { const n = { ...prev }; delete n[lineKey]; return n; });
  }

  function updateLine(lineKey: string, field: keyof PackingLine, raw: string) {
    const numFields = new Set<keyof PackingLine>(["qty", "unit_price", "no_of_ctns"]);
    setLines((prev) => {
      // Find the line being edited — needed for split parent lookup
      const editedLine = prev.find((l) => l.key === lineKey);
      return prev.map((ln) => {
        if (ln.key === lineKey) {
          const val = numFields.has(field) ? (Number(raw) || 0) : raw;
          const updated = { ...ln, [field]: val };
          if (field === "qty") {
            const sku = { unit_weight_kg: ln._unit_weight_kg, unit_cbm: ln._unit_cbm, carton_qty: ln._carton_qty, carton_weight_kg: ln._carton_weight_kg, carton_cbm: ln._carton_cbm };
            const phys = computePhysical(Number(raw) || 0, sku);
            return { ...updated, ...phys, amount: (Number(raw) || 0) * ln.unit_price };
          }
          if (field === "unit_price") return { ...updated, amount: ln.qty * (Number(raw) || 0) };
          return updated;
        }
        // Auto-adjust parent when a split row's qty changes
        if (field === "qty" && editedLine?._parent_key === ln.key) {
          const splitQty = Number(raw) || 0;
          const original = editedLine._split_from_qty ?? (ln.qty + splitQty);
          const remaining = Math.max(0, original - splitQty);
          const sku = { unit_weight_kg: ln._unit_weight_kg, unit_cbm: ln._unit_cbm, carton_qty: ln._carton_qty, carton_weight_kg: ln._carton_weight_kg, carton_cbm: ln._carton_cbm };
          const phys = computePhysical(remaining, sku);
          return { ...ln, qty: remaining, ...phys, amount: remaining * ln.unit_price };
        }
        return ln;
      });
    });
  }

  function moveLine(key: string, dir: "up" | "down") {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (dir === "up" && idx === 0) return prev;
      if (dir === "down" && idx === prev.length - 1) return prev;
      const next = [...prev];
      const swap = dir === "up" ? idx - 1 : idx + 1;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function splitLine(key: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx === -1) return prev;
      const o = prev[idx];
      const splitRow: PackingLine = {
        ...o,
        key: Math.random().toString(36).slice(2),
        qty: 0,
        no_of_ctns: 0, tot_cbm: 0, total_weight_kg: 0, amount: 0,
        box_no: 0,
        _parent_key: o.key,
        _split_from_qty: o.qty,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, splitRow);
      return next;
    });
  }

  // Box assignment
  function assignToBox(boxNo: number) {
    setLines((prev) => prev.map((l) => selectedKeys.has(l.key) ? { ...l, box_no: boxNo } : l));
    setSelectedKeys(new Set());
    setBoxData((prev) => ({ ...prev, [boxNo]: prev[boxNo] ?? { ctns: 1 } }));
  }

  function assignToNewBox() {
    const used = lines.map((l) => l.box_no).filter((b) => b > 0);
    const next = used.length === 0 ? 1 : Math.max(...used) + 1;
    assignToBox(next);
  }

  function unassignSelected() {
    setLines((prev) => prev.map((l) => selectedKeys.has(l.key) ? { ...l, box_no: 0 } : l));
    setSelectedKeys(new Set());
  }

  function removeBox(boxNo: number) {
    setLines((prev) => prev.map((l) => l.box_no === boxNo ? { ...l, box_no: 0 } : l));
    setBoxData((prev) => { const n = { ...prev }; delete n[boxNo]; return n; });
  }

  function autoSplitLine(key: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx === -1) return prev;
      const o = prev[idx];
      const cq = o._carton_qty;
      if (!cq || cq <= 0 || o.qty <= cq) return prev;
      const sku = { unit_weight_kg: o._unit_weight_kg, unit_cbm: o._unit_cbm, carton_qty: o._carton_qty, carton_weight_kg: o._carton_weight_kg, carton_cbm: o._carton_cbm };
      const newRows: PackingLine[] = [];
      let remaining = o.qty - cq;
      while (remaining > 0) {
        const chunkQty = Math.min(cq, remaining);
        const phys = computePhysical(chunkQty, sku);
        newRows.push({ ...o, key: Math.random().toString(36).slice(2), qty: chunkQty, ...phys, amount: chunkQty * o.unit_price, box_no: 0, _parent_key: undefined, _split_from_qty: undefined });
        remaining -= chunkQty;
      }
      const firstPhys = computePhysical(cq, sku);
      const updatedFirst = { ...o, qty: cq, ...firstPhys, amount: cq * o.unit_price, box_no: 0, _parent_key: undefined, _split_from_qty: undefined };
      const next = [...prev];
      next.splice(idx, 1, updatedFirst, ...newRows);
      return next;
    });
  }

  // Split a row by carton_qty and assign each chunk to its own new sequential box
  function splitToBoxes(key: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx === -1) return prev;
      const o = prev[idx];
      const cq = o._carton_qty;
      if (!cq || cq <= 0) return prev;
      const sku = { unit_weight_kg: o._unit_weight_kg, unit_cbm: o._unit_cbm, carton_qty: o._carton_qty, carton_weight_kg: o._carton_weight_kg, carton_cbm: o._carton_cbm };
      const usedBoxNos = prev.map((l) => l.box_no).filter((b) => b > 0);
      let nextBox = usedBoxNos.length > 0 ? Math.max(...usedBoxNos) + 1 : 1;
      const chunks: PackingLine[] = [];
      let remaining = o.qty;
      while (remaining > 0) {
        const chunkQty = Math.min(cq, remaining);
        const phys = computePhysical(chunkQty, sku);
        chunks.push({ ...o, key: Math.random().toString(36).slice(2), qty: chunkQty, ...phys, amount: chunkQty * o.unit_price, box_no: nextBox++, _parent_key: undefined, _split_from_qty: undefined });
        remaining -= chunkQty;
      }
      const next = [...prev];
      next.splice(idx, 1, ...chunks);
      return next;
    });
    // Update boxData for newly created boxes (CTN=1 each)
    setLines((prev) => {
      const newBoxNos = prev.map((l) => l.box_no).filter((b) => b > 0);
      setBoxData((bd) => {
        const updated = { ...bd };
        for (const b of newBoxNos) { if (!updated[b]) updated[b] = { ctns: 1 }; }
        return updated;
      });
      return prev;
    });
  }

  function boxLabel(boxNo: number): string {
    const lbl = shippingLabel.trim().toUpperCase();
    return lbl ? `${lbl}-${String(boxNo).padStart(2, "0")}` : `Box ${boxNo}`;
  }

  // PDF import
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true); setImportErr(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/packing/parse-document", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const json = await res.json() as { ok: boolean; customer_name?: string; doc_no?: string; doc_date?: string; items?: ParsedItem[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Parse failed");
      if (!json.items?.length) throw new Error("No line items found in this document.");
      setImportPreview({ customer_name: json.customer_name ?? "", doc_no: json.doc_no ?? "", doc_date: json.doc_date ?? "", items: json.items });
    } catch (e) { setImportErr(e instanceof Error ? e.message : "Import failed."); }
    finally { setImporting(false); }
  }

  async function confirmImport(selected: ParsedItem[]) {
    const preview = importPreview;
    setImportPreview(null);
    if (!preview) return;
    if (!consigneeName && preview.customer_name) setConsigneeName(preview.customer_name);
    if (!invoiceNo && preview.doc_no) setInvoiceNo(preview.doc_no);
    if (listDate === TODAY && preview.doc_date) setListDate(preview.doc_date);

    const token = await getToken();
    const newLines: PackingLine[] = [];
    for (const item of selected) {
      const line = newLine();
      line.model_no = item.model_no; line.brand = item.brand; line.description = item.description;
      line.qty = item.qty; line.unit_price = item.unit_price; line.amount = item.qty * item.unit_price;
      try {
        // Try exact match first, then closest match
        const catRes = await fetch(`/api/packing/catalog?q=${encodeURIComponent(item.model_no)}`, { headers: { Authorization: `Bearer ${token}` } });
        const catJson = await catRes.json() as { ok: boolean; items: SkuCatalogRow[] };
        const exactSku = catJson.items?.find((s) => s.model_no.toLowerCase() === item.model_no.toLowerCase()) ?? null;

        if (exactSku) {
          // Link existing catalog SKU
          line._sku_id = exactSku.id;
          line.hs_code = exactSku.hs_code ?? ""; line.country_of_origin = exactSku.country_of_origin;
          line._unit_weight_kg = exactSku.unit_weight_kg; line._unit_cbm = exactSku.unit_cbm;
          line._carton_qty = exactSku.carton_qty; line._carton_weight_kg = exactSku.carton_weight_kg; line._carton_cbm = exactSku.carton_cbm;
          const phys = computePhysical(line.qty, exactSku);
          line.no_of_ctns = phys.no_of_ctns; line.tot_cbm = phys.tot_cbm; line.total_weight_kg = phys.total_weight_kg;
          if (!line.brand && exactSku.brand) line.brand = exactSku.brand;
          if (!line.description && exactSku.description) line.description = exactSku.description;
        } else {
          // No catalog match — auto-create a new SKU entry with the available info
          const createRes = await fetch("/api/packing/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              model_no: item.model_no,
              brand: item.brand || null,
              description: item.description || null,
              country_of_origin: "China",
              hs_code: null, unit_weight_kg: null, unit_cbm: null,
              carton_qty: null, carton_weight_kg: null, carton_cbm: null,
              notes: "Auto-created from document import",
            }),
          });
          const createJson = await createRes.json() as { ok: boolean; item?: SkuCatalogRow };
          if (createJson.ok && createJson.item) {
            line._sku_id = createJson.item.id;
          }
        }
      } catch { /* non-fatal */ }
      newLines.push(line);
    }
    setLines((prev) => [...prev.filter((l) => l.model_no.trim()), ...newLines]);
  }

  // Pre-compute rowspan info for the Ctns column (consecutive same-box runs)
  const lineGroupInfo = lines.map((ln, idx) => {
    if (ln.box_no === 0) return { showCtn: true, span: 1 };
    const prev = idx > 0 ? lines[idx - 1] : null;
    if (prev && prev.box_no === ln.box_no) return { showCtn: false, span: 0 };
    let count = 1;
    let j = idx + 1;
    while (j < lines.length && lines[j].box_no === ln.box_no) { count++; j++; }
    return { showCtn: true, span: count };
  });

  // Totals
  const uniqueAssignedBoxes = [...new Set(lines.map((l) => l.box_no).filter((b) => b > 0))].sort((a, b) => a - b);
  const unassignedFilled = lines.filter((l) => l.box_no === 0 && l.model_no.trim());
  const totCtns = uniqueAssignedBoxes.reduce((s, b) => s + (boxData[b]?.ctns ?? 0), 0)
    + unassignedFilled.reduce((s, l) => s + l.no_of_ctns, 0);
  const totCBM = lines.reduce((s, l) => s + l.tot_cbm, 0);
  const totWeight = lines.reduce((s, l) => s + l.total_weight_kg, 0);
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const grandTotal = subtotal + vat;
  const countries = [...new Set(lines.map((l) => l.country_of_origin).filter(Boolean))].join(", ");

  async function save(status: "draft" | "final") {
    setSaving(true); setSaveErr(null);
    const id = editId ?? searchParams.get("edit");
    try {
      const token = await getToken();
      const filledLines = lines.filter((l) => l.model_no.trim());
      const items = filledLines.map((l) => {
        let no_of_ctns = l.no_of_ctns;
        const tot_cbm = l.tot_cbm; // always per-item computed value
        if (l.box_no > 0) {
          const boxLines = filledLines.filter((x) => x.box_no === l.box_no);
          const isPrimary = boxLines[0].key === l.key;
          if (isPrimary) { no_of_ctns = boxData[l.box_no]?.ctns ?? 1; }
          else { no_of_ctns = 0; }
        }
        return {
          model_no: l.model_no, brand: l.brand, description: l.description,
          hs_code: l.hs_code, country_of_origin: l.country_of_origin,
          qty: l.qty, no_of_ctns, tot_cbm, total_weight_kg: l.total_weight_kg, box_no: l.box_no,
          unit_price: mode === "invoice" ? l.unit_price : null,
          amount: mode === "invoice" ? l.amount : null,
        };
      });
      const payload = { company, mode, invoice_no: invoiceNo || null, list_date: listDate, consignee_name: consigneeName || null, consignee_address: consigneeAddress || null, notes: notes || null, status, shipping_label: shippingLabel.trim() || null, items };
      let res = await fetch(id ? `/api/packing/lists/${id}` : "/api/packing/lists", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      // If the list was deleted, fall back to creating a new one
      if (res.status === 404 && id) {
        res = await fetch("/api/packing/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
      }
      const json = await res.json() as { ok: boolean; id?: string; error?: string };
      if (!json.ok) throw new Error(json.error);
      if (userId) { try { localStorage.removeItem(draftKey(userId)); } catch { /* ignore */ } }
      router.push(`/logistics/packing-list/${json.id ?? id}`);
    } catch (e) { setSaveErr(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const cellInp = "rounded border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800";
  const allSelected = lines.length > 0 && selectedKeys.size === lines.length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {editId ?? searchParams.get("edit") ? "Edit Packing List" : "New Packing List"}
        </h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300">
            {importing ? <><span className="animate-spin inline-block">⏳</span> Parsing…</> : <>📄 Import from PDF</>}
          </button>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />
          <button type="button" onClick={() => {
              if (userId) { try { localStorage.removeItem(draftKey(userId)); } catch { /* ignore */ } }
              router.push("/logistics/packing-list");
            }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Cancel</button>
          <button type="button" onClick={() => save("draft")} disabled={saving}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
            {saving ? "Saving…" : "Save Draft"}
          </button>
          <button type="button" onClick={() => save("final")} disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving ? "Saving…" : "Finalise & View"}
          </button>
        </div>
      </div>

      {importErr && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          ⚠ {importErr}
          <button type="button" className="ml-auto text-amber-400 hover:text-amber-600" onClick={() => setImportErr(null)}>✕</button>
        </div>
      )}
      {saveErr && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveErr}</div>}

      {/* Company + Mode */}
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Company</p>
          <div className="flex rounded-xl border border-slate-200 p-1 dark:border-slate-700">
            {(["techniline", "soundline"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCompany(c)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${company === c ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400"}`}>
                {c === "techniline" ? "Techniline" : "Soundline"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Document Mode</p>
          <div className="flex rounded-xl border border-slate-200 p-1 dark:border-slate-700">
            {([["physical", "Packing List Only"], ["invoice", "Packing List + Tax Invoice"]] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${mode === m ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Header fields */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div><label className="mb-1 block text-xs font-medium text-slate-500">Invoice No</label>
            <input className={inputCls} placeholder="e.g. WS/2600001" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
            <input type="date" className={inputCls} value={listDate} onChange={(e) => setListDate(e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-slate-500">Consignee Name</label>
            <input className={inputCls} placeholder="Customer / Company" value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} /></div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Shipping Label
              <span className="ml-1 font-normal text-slate-400">(e.g. MYG → MYG-01, MYG-02…)</span>
            </label>
            <input className={`${inputCls} uppercase`} placeholder="e.g. MYG" value={shippingLabel}
              onChange={(e) => setShippingLabel(e.target.value.toUpperCase())} />
          </div>
          <div><label className="mb-1 block text-xs font-medium text-slate-500">Notes</label>
            <input className={inputCls} placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="col-span-2 md:col-span-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Consignee Address</label>
            <textarea rows={2} className={`${inputCls} resize-none`} placeholder="Address, City, Country"
              value={consigneeAddress} onChange={(e) => setConsigneeAddress(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Selection assignment bar */}
      {selectedKeys.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 dark:border-indigo-800 dark:bg-indigo-950/40">
          <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">{selectedKeys.size} selected</span>
          <span className="text-sm text-indigo-400">→</span>
          {uniqueAssignedBoxes.map((b) => {
            const col = getBoxColour(b)!;
            return (
              <button key={b} type="button" onClick={() => assignToBox(b)}
                className={`rounded-full px-3 py-0.5 text-xs font-semibold ${col.badge}`}>
                {boxLabel(b)}
              </button>
            );
          })}
          <button type="button" onClick={assignToNewBox}
            className="rounded-full bg-indigo-600 px-3 py-0.5 text-xs font-semibold text-white hover:bg-indigo-700">
            + New Box
          </button>
          <div className="flex items-center gap-1">
            <span className="text-xs text-indigo-400">or box #</span>
            <input
              type="number" min="1" step="1" placeholder="#"
              value={manualBoxNo}
              onChange={(e) => setManualBoxNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = parseInt(manualBoxNo, 10);
                  if (n > 0) { assignToBox(n); setManualBoxNo(""); }
                }
              }}
              className="w-14 rounded border border-indigo-200 bg-white px-2 py-0.5 text-center text-xs focus:border-indigo-500 focus:outline-none dark:border-indigo-700 dark:bg-slate-800" />
            <button type="button"
              onClick={() => { const n = parseInt(manualBoxNo, 10); if (n > 0) { assignToBox(n); setManualBoxNo(""); } }}
              disabled={!manualBoxNo || parseInt(manualBoxNo, 10) < 1}
              className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-200 disabled:opacity-40">
              Assign
            </button>
          </div>
          <button type="button" onClick={unassignSelected}
            className="rounded-full border border-slate-300 px-3 py-0.5 text-xs text-slate-500 hover:bg-slate-100">
            Unassign
          </button>
          <button type="button" onClick={() => setSelectedKeys(new Set())}
            className="ml-auto text-xs text-indigo-400 hover:text-indigo-600">✕ Clear selection</button>
        </div>
      )}

      {/* Line items table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[1050px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
              <th className="px-3 py-2 text-center w-8">
                <input type="checkbox" checked={allSelected} onChange={(e) => setSelectedKeys(e.target.checked ? new Set(lines.map((l) => l.key)) : new Set())} />
              </th>
              <th className="px-2 py-2 text-left w-6">#</th>
              <th className="px-2 py-2 text-left">Model No</th>
              <th className="px-2 py-2 text-left">Brand</th>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="px-2 py-2 text-left">Country</th>
              <th className="px-2 py-2 text-left">HS Code</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right" title="Units per master carton (from catalog)">Pcs/Ctn</th>
              <th className="px-2 py-2 text-center">No. of Ctns</th>
              <th className="px-2 py-2 text-right">Weight kg</th>
              {mode === "invoice" && <th className="px-2 py-2 text-right">Unit Price</th>}
              {mode === "invoice" && <th className="px-2 py-2 text-right">Amount</th>}
              <th className="px-2 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {lines.map((ln, idx) => {
              const col = getBoxColour(ln.box_no);
              const isSelected = selectedKeys.has(ln.key);
              return (
                <tr key={ln.key}
                  className={`${col?.row ?? "bg-white dark:bg-slate-900"} ${isSelected ? "outline outline-2 outline-indigo-400 outline-offset-[-2px]" : ""} transition-colors`}>
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={isSelected} onChange={(e) => {
                      const next = new Set(selectedKeys);
                      e.target.checked ? next.add(ln.key) : next.delete(ln.key);
                      setSelectedKeys(next);
                    }} />
                  </td>
                  <td className="px-2 py-1.5 text-center text-xs text-slate-400">{idx + 1}</td>

                  {/* Model No + autocomplete */}
                  <td className="relative px-2 py-1.5">
                    <input className={`w-32 ${cellInp} font-mono`} value={ln.model_no} placeholder="Model No"
                      onChange={(e) => { updateLine(ln.key, "model_no", e.target.value); searchSku(e.target.value, ln.key); }}
                      onFocus={() => { if (ln.model_no) searchSku(ln.model_no, ln.key); }}
                      onBlur={() => setTimeout(() => setSuggestions([]), 200)} />
                    {activeLineKey === ln.key && (suggestions.length > 0 || ln.model_no.trim()) && (
                      <div className="absolute left-2 top-full z-20 mt-0.5 w-80 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                        {suggestions.map((s) => (
                          <button key={s.id} type="button" onMouseDown={() => applySku(s, ln.key)}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
                            <span className="mt-0.5 font-mono text-xs text-indigo-600">{s.model_no}</span>
                            <span className="text-xs text-slate-400">{s.brand}</span>
                            <span className="flex-1 text-xs text-slate-500 line-clamp-1">{s.description}</span>
                          </button>
                        ))}
                        {suggestions.length === 0 && (
                          <p className="px-3 py-2 text-xs text-slate-400">No catalog match for &quot;{ln.model_no}&quot;</p>
                        )}
                        <button type="button" onMouseDown={() => { setSuggestions([]); setSkuModal({ initial: { model_no: ln.model_no, brand: ln.brand || undefined, description: ln.description || undefined, hs_code: ln.hs_code || undefined, country_of_origin: ln.country_of_origin || "China" }, lineKey: ln.key }); }}
                          className="w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-900/20">
                          + Add &quot;{ln.model_no}&quot; to catalog
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Brand + autocomplete from catalog */}
                  <td className="relative px-2 py-1.5">
                    <input
                      className={`w-24 ${cellInp}`}
                      value={ln.brand}
                      placeholder="Brand"
                      onChange={(e) => {
                        updateLine(ln.key, "brand", e.target.value);
                        setBrandQuery(e.target.value);
                        setBrandSuggestKey(ln.key);
                      }}
                      onFocus={() => { setBrandSuggestKey(ln.key); setBrandQuery(ln.brand); }}
                      onBlur={() => setTimeout(() => setBrandSuggestKey(null), 200)}
                    />
                    {brandSuggestKey === ln.key && (() => {
                      const q = brandQuery.toLowerCase();
                      const filtered = allBrands.filter((b) => b.toLowerCase().includes(q) && b.toLowerCase() !== q);
                      return filtered.length > 0 ? (
                        <div className="absolute left-2 top-full z-20 mt-0.5 w-48 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                          {filtered.slice(0, 8).map((b) => (
                            <button key={b} type="button"
                              onMouseDown={() => { updateLine(ln.key, "brand", b); setBrandSuggestKey(null); }}
                              className="flex w-full items-center px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
                              {b}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </td>
                  <td className="px-2 py-1.5"><input className={`w-52 ${cellInp}`} value={ln.description} onChange={(e) => updateLine(ln.key, "description", e.target.value)} /></td>
                  <td className="px-2 py-1.5"><input className={`w-16 ${cellInp}`} value={ln.country_of_origin} onChange={(e) => updateLine(ln.key, "country_of_origin", e.target.value)} /></td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        className={`w-20 ${cellInp} font-mono ${catalogDirty[ln.key]?.has("hs_code") ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500" : ""}`}
                        value={ln.hs_code}
                        onChange={(e) => {
                          updateLine(ln.key, "hs_code", e.target.value);
                          if (ln._sku_id) markCatalogDirty(ln.key, "hs_code");
                        }}
                      />
                      {ln._sku_id && catalogDirty[ln.key]?.has("hs_code") && (
                        <button type="button" title="Save HS Code to catalog"
                          disabled={catalogSaving.has(ln.key)}
                          onClick={() => saveCatalogFields(ln.key)}
                          className="text-amber-500 hover:text-amber-700 disabled:opacity-40 text-sm leading-none">
                          {catalogSaving.has(ln.key) ? "…" : "💾"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min="1" step="1" className={`w-14 ${cellInp} text-right`} value={ln.qty}
                      onChange={(e) => updateLine(ln.key, "qty", e.target.value)} />
                  </td>

                  {/* Pcs per carton — editable, builder only, not printed */}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1 justify-end">
                      <input
                        type="number" min="1" step="1"
                        value={ln._carton_qty ?? ""}
                        placeholder="—"
                        title={ln._sku_id ? "Enter to save to catalog" : "Link a catalog SKU first to save"}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          setLines((prev) => prev.map((l) => {
                            if (l.key !== ln.key) return l;
                            const sku = { unit_weight_kg: l._unit_weight_kg, unit_cbm: l._unit_cbm, carton_qty: val, carton_weight_kg: l._carton_weight_kg, carton_cbm: l._carton_cbm };
                            const phys = computePhysical(l.qty, sku);
                            return { ...l, _carton_qty: val, ...phys };
                          }));
                          if (ln._sku_id) markCatalogDirty(ln.key, "carton_qty");
                        }}
                        className={`w-14 rounded border px-1 py-0.5 text-right text-xs tabular-nums focus:outline-none focus:border-indigo-400 ${
                          catalogDirty[ln.key]?.has("carton_qty")
                            ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500"
                            : "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
                        }`}
                      />
                      {ln._sku_id && catalogDirty[ln.key]?.has("carton_qty") && (
                        <button type="button" title="Save Pcs/Ctn to catalog"
                          disabled={catalogSaving.has(ln.key)}
                          onClick={() => saveCatalogFields(ln.key)}
                          className="text-amber-500 hover:text-amber-700 disabled:opacity-40 text-sm leading-none">
                          {catalogSaving.has(ln.key) ? "…" : "💾"}
                        </button>
                      )}
                    </div>
                    {catalogSaveErr[ln.key] && (
                      <p className="mt-0.5 text-[10px] text-red-500">{catalogSaveErr[ln.key]}</p>
                    )}
                  </td>

                  {/* No. of Ctns — rowspan for consecutive box groups */}
                  {(() => {
                    const ginfo = lineGroupInfo[idx];
                    if (!ginfo.showCtn) return null;
                    return (
                      <td
                        rowSpan={ginfo.span > 1 ? ginfo.span : undefined}
                        className="px-2 py-1.5 text-center align-middle"
                      >
                        {ln.box_no > 0 ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${col!.badge}`}>
                              {boxLabel(ln.box_no)}
                            </span>
                            <input
                              type="number" min="0" step="1"
                              value={boxData[ln.box_no]?.ctns ?? 1}
                              onChange={(e) =>
                                setBoxData((p) => ({
                                  ...p,
                                  [ln.box_no]: { ...(p[ln.box_no] ?? { ctns: 1 }), ctns: Number(e.target.value) || 0 },
                                }))
                              }
                              className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 text-center text-xs font-bold focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800"
                            />
                          </div>
                        ) : (
                          <input
                            type="number" min="0" step="1"
                            value={ln.no_of_ctns || ""}
                            placeholder="auto"
                            onChange={(e) => updateLine(ln.key, "no_of_ctns", e.target.value)}
                            className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 text-center text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800"
                          />
                        )}
                      </td>
                    );
                  })()}

                  <td className="px-2 py-1.5 text-right text-xs text-slate-500 tabular-nums">{ln.total_weight_kg.toFixed(2)}</td>

                  {mode === "invoice" && (
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="any" className={`w-24 ${cellInp} text-right`}
                        value={ln.unit_price || ""} placeholder="0.00" onChange={(e) => updateLine(ln.key, "unit_price", e.target.value)} />
                    </td>
                  )}
                  {mode === "invoice" && (
                    <td className="px-2 py-1.5 text-right text-xs font-medium text-slate-700 dark:text-slate-300 tabular-nums">{fmt2(ln.amount)}</td>
                  )}

                  {/* Actions */}
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col items-center gap-1">
                      {/* Reorder */}
                      <div className="flex gap-0.5">
                        <button type="button" title="Move up" onClick={() => moveLine(ln.key, "up")} disabled={idx === 0}
                          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-20">▲</button>
                        <button type="button" title="Move down" onClick={() => moveLine(ln.key, "down")} disabled={idx === lines.length - 1}
                          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-20">▼</button>
                      </div>
                      {/* Add / edit in catalog */}
                      <button type="button"
                        title={ln._sku_id ? "Edit this SKU in the catalog (add missing details)" : "Add this product to the catalog"}
                        onClick={() => setSkuModal({
                          lineKey: ln.key,
                          initial: {
                            id: ln._sku_id ?? undefined,
                            model_no: ln.model_no,
                            brand: ln.brand || undefined,
                            description: ln.description || undefined,
                            hs_code: ln.hs_code || undefined,
                            country_of_origin: ln.country_of_origin || "China",
                            unit_weight_kg: ln._unit_weight_kg,
                            unit_cbm: ln._unit_cbm,
                            carton_qty: ln._carton_qty,
                            carton_weight_kg: ln._carton_weight_kg,
                            carton_cbm: ln._carton_cbm,
                          },
                        })}
                        className={`rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                          ln._sku_id
                            ? "bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400"
                            : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400"
                        }`}>
                        {ln._sku_id ? "✏️ Edit SKU" : "➕ Add SKU"}
                      </button>
                      {/* Manual split — add a sibling row; editing its qty auto-adjusts the parent */}
                      <button type="button"
                        title="Split this line — a new row appears below; set its qty and the parent qty adjusts automatically"
                        disabled={ln.qty <= 1}
                        onClick={() => splitLine(ln.key)}
                        className="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-30 dark:bg-violet-900/30 dark:text-violet-400 whitespace-nowrap">
                        ✂ Split
                      </button>
                      {/* Split to individual boxes */}
                      <button type="button"
                        title={ln._carton_qty && ln._carton_qty > 0 ? `Each carton gets its own box — creates ${Math.ceil(ln.qty / ln._carton_qty)} boxes` : "Needs carton qty from catalog"}
                        disabled={!ln._carton_qty || ln._carton_qty <= 0}
                        onClick={() => splitToBoxes(ln.key)}
                        className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-30 dark:bg-emerald-900/30 dark:text-emerald-400 whitespace-nowrap">
                        📦 1 per box
                      </button>
                      {/* Remove — if this is a split child, restore its qty to the parent first */}
                      <button type="button" onClick={() => setLines((p) => {
                        const parentKey = ln._parent_key;
                        return p
                          .filter((x) => x.key !== ln.key)
                          .map((x) => {
                            if (!parentKey || x.key !== parentKey || ln.qty === 0) return x;
                            const restoredQty = x.qty + ln.qty;
                            const sku = { unit_weight_kg: x._unit_weight_kg, unit_cbm: x._unit_cbm, carton_qty: x._carton_qty, carton_weight_kg: x._carton_weight_kg, carton_cbm: x._carton_cbm };
                            return { ...x, qty: restoredQty, ...computePhysical(restoredQty, sku), amount: restoredQty * x.unit_price };
                          });
                      })}
                        className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 whitespace-nowrap">
                        ✕ Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800/60">
              <td colSpan={7} className="px-2 py-2 text-right text-slate-500">Total</td>
              <td className="px-2 py-2 text-right tabular-nums">{lines.reduce((s, l) => s + l.qty, 0)}</td>
              <td />{/* Pcs/Ctn — no total */}
              <td className="px-2 py-2 text-center tabular-nums font-bold">{totCtns || "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{totWeight.toFixed(2)}</td>
              {mode === "invoice" && <td />}
              {mode === "invoice" && <td className="px-2 py-2 text-right tabular-nums">{fmt2(subtotal)}</td>}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add line */}
      <button type="button" onClick={() => setLines((p) => [...p, newLine()])}
        className="flex items-center gap-2 rounded-lg border border-dashed border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:border-indigo-500 hover:bg-indigo-50">
        + Add Line
      </button>

      {/* Box summary panel */}
      {(uniqueAssignedBoxes.length > 0 || unassignedFilled.length > 0) && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">📦 Box Summary</h3>
            <p className="text-xs text-slate-400">Carton counts are entered in the table above</p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {uniqueAssignedBoxes.map((boxNo) => {
              const col = getBoxColour(boxNo)!;
              const boxLines = lines.filter((l) => l.box_no === boxNo && l.model_no.trim());
              const boxWeight = boxLines.reduce((s, l) => s + l.total_weight_kg, 0);
              const meta = boxData[boxNo] ?? { ctns: 1 };
              const boxCBM = boxLines.reduce((s, l) => s + l.tot_cbm, 0);
              return (
                <div key={boxNo} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${col.row.split(" ")[0]}`}>
                  <div className="flex items-center gap-2 min-w-[90px]">
                    <span className={`h-3 w-3 rounded-full flex-shrink-0 ${col.dot}`} />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{boxLabel(boxNo)}</span>
                  </div>
                  <span className="text-xs text-slate-500">{boxLines.length} item{boxLines.length !== 1 ? "s" : ""}</span>

                  <span className="text-xs font-semibold text-slate-600 tabular-nums">{meta.ctns} CTN{meta.ctns !== 1 ? "s" : ""}</span>
                  <span className="text-xs text-slate-400">CBM: {fmt5(boxCBM)}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{boxWeight.toFixed(2)} kg</span>

                  <div className="flex-1 min-w-0 text-xs text-slate-400 truncate">
                    {boxLines.map((l) => `${l.model_no} ×${l.qty}`).join(" · ")}
                  </div>

                  <button type="button" onClick={() => removeBox(boxNo)}
                    className="text-xs text-rose-400 hover:text-rose-600 flex-shrink-0">
                    Remove
                  </button>
                </div>
              );
            })}

            {/* Unassigned */}
            {unassignedFilled.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900">
                <div className="flex items-center gap-2 min-w-[80px]">
                  <span className="h-3 w-3 rounded-full border-2 border-dashed border-slate-300 flex-shrink-0 dark:border-slate-600" />
                  <span className="text-sm font-medium text-slate-400">Unassigned</span>
                </div>
                <span className="text-xs text-slate-400">
                  {unassignedFilled.length} item{unassignedFilled.length !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-slate-400">
                  Auto CTNs: {unassignedFilled.reduce((s, l) => s + l.no_of_ctns, 0)} · CBM: {fmt5(unassignedFilled.reduce((s, l) => s + l.tot_cbm, 0))}
                </span>
                <div className="flex-1 text-xs text-slate-300 dark:text-slate-600 truncate">
                  {unassignedFilled.map((l) => `${l.model_no} ×${l.qty}`).join(" · ")}
                </div>
                <span className="text-xs italic text-amber-500">← select rows and assign to boxes above</span>
              </div>
            )}
          </div>

          {/* Totals bar */}
          <div className="flex flex-wrap gap-6 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <span>Total Cartons: {totCtns}</span>
            <span>Total CBM: {fmt5(totCBM)}</span>
            <span>Total Weight: {totWeight.toFixed(2)} kg</span>
            {countries && <span className="text-slate-400 font-normal">Country of Origin: {countries}</span>}
            {COMPANY_INFO[company] && <span className="text-slate-400 font-normal ml-auto">{COMPANY_INFO[company].name}</span>}
          </div>
        </div>
      )}

      {/* VAT summary (invoice mode) */}
      {mode === "invoice" && (
        <div className="flex justify-end">
          <div className="w-72 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium tabular-nums">AED {fmt2(subtotal)}</span></div>
              <div className="flex justify-between text-amber-700 dark:text-amber-400"><span>VAT 5%</span><span className="tabular-nums">AED {fmt2(vat)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold dark:border-slate-700">
                <span>Total</span><span className="tabular-nums">AED {fmt2(grandTotal)}</span>
              </div>
              <p className="pt-1 text-xs italic text-slate-400">{aedToWords(grandTotal)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {skuModal && (
        <SkuModal initial={skuModal.initial} onClose={() => setSkuModal(null)}
          onSave={(sku) => { applySku(sku, skuModal.lineKey); setSkuModal(null); }} />
      )}
      {importPreview && (
        <ImportPreviewModal items={importPreview.items} onClose={() => setImportPreview(null)} onConfirm={confirmImport} />
      )}
    </div>
  );
}
