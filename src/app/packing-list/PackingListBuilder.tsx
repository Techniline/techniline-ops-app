"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import {
  COMPANY_INFO,
  computePhysical,
  aedToWords,
  type PackingCompany,
  type PackingLine,
  type PackingMode,
  type SkuCatalogRow,
} from "@/lib/packing/types";
import type { ParsedItem } from "@/app/api/packing/parse-document/route";

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

const TODAY = new Date().toISOString().slice(0, 10);

function newLine(boxNo = 1): PackingLine {
  return {
    key: Math.random().toString(36).slice(2),
    model_no: "", brand: "", description: "", hs_code: "", country_of_origin: "China",
    qty: 1, no_of_ctns: 1, tot_cbm: 0, total_weight_kg: 0, unit_price: 0, amount: 0,
    box_no: boxNo,
    _unit_weight_kg: null, _unit_cbm: null, _carton_qty: null,
    _carton_weight_kg: null, _carton_cbm: null,
  };
}

function fmt2(n: number) {
  return n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt5(n: number) {
  return n.toFixed(5).replace(/\.?0+$/, "");
}

// ─── SKU Modal ────────────────────────────────────────────────────────────────
interface SkuModalProps {
  initial: Partial<SkuCatalogRow>;
  onSave: (sku: SkuCatalogRow) => void;
  onClose: () => void;
}

function SkuModal({ initial, onSave, onClose }: SkuModalProps) {
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
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { ok: boolean; item?: SkuCatalogRow; error?: string };
      if (!json.ok) throw new Error(json.error);
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
            {form.id ? "Edit SKU" : "Add SKU to Catalog"}
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
              {saving ? "Saving…" : "Save to Catalog"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Import Preview Modal ─────────────────────────────────────────────────────
function ImportPreviewModal({
  items,
  onConfirm,
  onClose,
}: {
  items: ParsedItem[];
  onConfirm: (selected: ParsedItem[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(items.map((_, i) => i)));
  const toggle = (i: number) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900" style={{ maxHeight: "80vh" }}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Import {items.length} line items</h2>
            <p className="text-xs text-slate-400">Deselect any items you don&apos;t want to import.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2 text-left w-8"></th>
                <th className="px-4 py-2 text-left">Model No</th>
                <th className="px-4 py-2 text-left">Brand</th>
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Unit Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item, i) => (
                <tr key={i} className={`cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50 ${!selected.has(i) ? "opacity-40" : ""}`} onClick={() => toggle(i)}>
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} className="rounded" />
                  </td>
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
  const [lines, setLines] = useState<PackingLine[]>([newLine(1)]);

  // SKU autocomplete
  const [suggestions, setSuggestions] = useState<SkuCatalogRow[]>([]);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [skuModal, setSkuModal] = useState<{ initial: Partial<SkuCatalogRow>; lineKey: string } | null>(null);
  const suggestRef = useRef<NodeJS.Timeout | null>(null);

  // PDF import
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{
    customer_name: string; doc_no: string; doc_date: string; items: ParsedItem[];
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Load existing list if editing
  useEffect(() => {
    const id = editId ?? searchParams.get("edit");
    if (!id) return;
    getToken().then((token) =>
      fetch(`/api/packing/lists/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    ).then((r) => r.json()).then((json) => {
      if (!json.ok) return;
      const l = json.list;
      setCompany(l.company);
      setMode(l.mode);
      setInvoiceNo(l.invoice_no ?? "");
      setListDate(l.list_date ?? TODAY);
      setConsigneeName(l.consignee_name ?? "");
      setConsigneeAddress(l.consignee_address ?? "");
      setNotes(l.notes ?? "");
      setLines(
        (json.items as PackingLine[]).map((item, i) => ({
          ...newLine(item.box_no ?? i + 1),
          ...item,
          key: Math.random().toString(36).slice(2),
          box_no: item.box_no ?? i + 1,
        }))
      );
    }).catch(() => {});
  }, [editId, searchParams]);

  // Debounced SKU search
  const searchSku = useCallback((q: string, lineKey: string) => {
    setActiveLineKey(lineKey);
    if (suggestRef.current) clearTimeout(suggestRef.current);
    if (!q.trim()) { setSuggestions([]); return; }
    suggestRef.current = setTimeout(async () => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/packing/catalog?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as { ok: boolean; items: SkuCatalogRow[] };
        if (json.ok) setSuggestions(json.items.slice(0, 10));
      } catch { /* ignore */ }
    }, 220);
  }, []);

  function applySku(sku: SkuCatalogRow, lineKey: string) {
    setSuggestions([]);
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== lineKey) return ln;
        const phys = computePhysical(ln.qty, sku);
        return {
          ...ln,
          model_no: sku.model_no,
          brand: sku.brand ?? "",
          description: sku.description ?? "",
          hs_code: sku.hs_code ?? "",
          country_of_origin: sku.country_of_origin,
          ...phys,
          amount: ln.qty * ln.unit_price,
          _unit_weight_kg: sku.unit_weight_kg,
          _unit_cbm: sku.unit_cbm,
          _carton_qty: sku.carton_qty,
          _carton_weight_kg: sku.carton_weight_kg,
          _carton_cbm: sku.carton_cbm,
        };
      })
    );
  }

  function updateLine(lineKey: string, field: keyof PackingLine, raw: string) {
    const numFields = new Set<keyof PackingLine>(["qty", "unit_price", "no_of_ctns", "tot_cbm", "box_no"]);
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== lineKey) return ln;
        const val = numFields.has(field) ? (Number(raw) || 0) : raw;
        const updated = { ...ln, [field]: val };
        if (field === "qty") {
          const sku = {
            unit_weight_kg: ln._unit_weight_kg, unit_cbm: ln._unit_cbm,
            carton_qty: ln._carton_qty, carton_weight_kg: ln._carton_weight_kg, carton_cbm: ln._carton_cbm,
          };
          const phys = computePhysical(Number(raw) || 0, sku);
          return { ...updated, ...phys, amount: (Number(raw) || 0) * ln.unit_price };
        }
        if (field === "unit_price") return { ...updated, amount: ln.qty * (Number(raw) || 0) };
        return updated;
      })
    );
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

  function mergeWithAbove(key: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx <= 0) return prev;
      const aboveBoxNo = prev[idx - 1].box_no;
      return prev.map((l, i) =>
        i === idx ? { ...l, box_no: aboveBoxNo, no_of_ctns: 0, tot_cbm: 0 } : l
      );
    });
  }

  function addLine() {
    const maxBox = lines.length === 0 ? 0 : Math.max(...lines.map((l) => l.box_no));
    setLines((p) => [...p, newLine(maxBox + 1)]);
  }

  // ─── PDF Import ─────────────────────────────────────────────────────────────

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true); setImportErr(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/packing/parse-document", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = (await res.json()) as {
        ok: boolean; customer_name?: string; doc_no?: string; doc_date?: string;
        items?: ParsedItem[]; error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "Parse failed");
      if (!json.items?.length) throw new Error("No line items found in this document.");
      setImportPreview({
        customer_name: json.customer_name ?? "",
        doc_no: json.doc_no ?? "",
        doc_date: json.doc_date ?? "",
        items: json.items,
      });
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport(selected: ParsedItem[]) {
    setImportPreview(null);
    const preview = importPreview;
    if (!preview) return;

    // Fill header fields if empty
    if (!consigneeName && preview.customer_name) setConsigneeName(preview.customer_name);
    if (!invoiceNo && preview.doc_no) setInvoiceNo(preview.doc_no);
    if (listDate === TODAY && preview.doc_date) setListDate(preview.doc_date);

    // For each item: look up catalog, build PackingLine
    const token = await getToken();
    const maxBox = lines.filter((l) => l.model_no).length === 0
      ? 0 : Math.max(...lines.map((l) => l.box_no));
    let boxCounter = maxBox;

    const newLines: PackingLine[] = [];
    for (const item of selected) {
      boxCounter++;
      const line = newLine(boxCounter);
      line.model_no = item.model_no;
      line.brand = item.brand;
      line.description = item.description;
      line.qty = item.qty;
      line.unit_price = item.unit_price;
      line.amount = item.qty * item.unit_price;

      try {
        const catRes = await fetch(`/api/packing/catalog?q=${encodeURIComponent(item.model_no)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const catJson = (await catRes.json()) as { ok: boolean; items: SkuCatalogRow[] };
        const sku = catJson.items?.find(
          (s) => s.model_no.toLowerCase() === item.model_no.toLowerCase()
        ) ?? catJson.items?.[0] ?? null;

        if (sku) {
          line.hs_code = sku.hs_code ?? "";
          line.country_of_origin = sku.country_of_origin;
          line._unit_weight_kg = sku.unit_weight_kg;
          line._unit_cbm = sku.unit_cbm;
          line._carton_qty = sku.carton_qty;
          line._carton_weight_kg = sku.carton_weight_kg;
          line._carton_cbm = sku.carton_cbm;
          const phys = computePhysical(line.qty, sku);
          line.no_of_ctns = phys.no_of_ctns;
          line.tot_cbm = phys.tot_cbm;
          line.total_weight_kg = phys.total_weight_kg;
          if (!line.brand && sku.brand) line.brand = sku.brand;
          if (!line.description && sku.description) line.description = sku.description;
        }
      } catch { /* catalog lookup failure is non-fatal */ }

      newLines.push(line);
    }

    setLines((prev) => {
      const filled = prev.filter((l) => l.model_no.trim());
      return [...filled, ...newLines];
    });
  }

  // ─── Totals ──────────────────────────────────────────────────────────────────

  const totCBM = lines.reduce((s, l) => s + (l.tot_cbm || 0), 0);
  const totWeight = lines.reduce((s, l) => s + (l.total_weight_kg || 0), 0);
  const totCtns = lines.reduce((s, l) => s + (l.no_of_ctns || 0), 0);
  const subtotal = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const grandTotal = subtotal + vat;
  const countries = [...new Set(lines.map((l) => l.country_of_origin).filter(Boolean))].join(", ");

  async function save(status: "draft" | "final") {
    setSaving(true); setSaveErr(null);
    const id = editId ?? searchParams.get("edit");
    try {
      const token = await getToken();
      const payload = {
        company, mode, invoice_no: invoiceNo || null, list_date: listDate,
        consignee_name: consigneeName || null, consignee_address: consigneeAddress || null,
        notes: notes || null, status,
        items: lines.filter((l) => l.model_no.trim()).map((l) => ({
          model_no: l.model_no, brand: l.brand, description: l.description,
          hs_code: l.hs_code, country_of_origin: l.country_of_origin,
          qty: l.qty, no_of_ctns: l.no_of_ctns, tot_cbm: l.tot_cbm,
          total_weight_kg: l.total_weight_kg, box_no: l.box_no,
          unit_price: mode === "invoice" ? l.unit_price : null,
          amount: mode === "invoice" ? l.amount : null,
        })),
      };
      const res = await fetch(id ? `/api/packing/lists/${id}` : "/api/packing/lists", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok: boolean; id?: string; error?: string };
      if (!json.ok) throw new Error(json.error);
      router.push(`/packing-list/${json.id ?? id}`);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally { setSaving(false); }
  }

  const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const cellInp = "rounded border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800";

  // Box colour coding — quick visual grouping
  const BOX_COLOURS = [
    "bg-white dark:bg-slate-900",
    "bg-sky-50/60 dark:bg-sky-950/30",
    "bg-violet-50/60 dark:bg-violet-950/30",
    "bg-amber-50/60 dark:bg-amber-950/30",
    "bg-emerald-50/60 dark:bg-emerald-950/30",
    "bg-rose-50/60 dark:bg-rose-950/30",
  ];
  const uniqueBoxNos = [...new Set(lines.map((l) => l.box_no))].sort((a, b) => a - b);
  const boxColourMap = new Map(uniqueBoxNos.map((b, i) => [b, BOX_COLOURS[i % BOX_COLOURS.length]]));

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {editId ?? searchParams.get("edit") ? "Edit Packing List" : "New Packing List"}
        </h1>
        <div className="flex flex-wrap gap-2">
          {/* PDF import button */}
          <button type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300">
            {importing ? (
              <><span className="animate-spin">⏳</span> Parsing…</>
            ) : (
              <>📄 Import from PDF</>
            )}
          </button>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />
          <button type="button" onClick={() => router.push("/packing-list")}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
            Cancel
          </button>
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
          <span>⚠</span> {importErr}
          <button type="button" className="ml-auto text-amber-400 hover:text-amber-600" onClick={() => setImportErr(null)}>✕</button>
        </div>
      )}
      {saveErr && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveErr}</div>
      )}

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
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Invoice No</label>
            <input className={inputCls} placeholder="e.g. WS/2600001" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
            <input type="date" className={inputCls} value={listDate} onChange={(e) => setListDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Consignee Name</label>
            <input className={inputCls} placeholder="Customer / Company" value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Notes</label>
            <input className={inputCls} placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-500">Consignee Address</label>
            <textarea rows={2} className={`${inputCls} resize-none`} placeholder="Address, City, Country"
              value={consigneeAddress} onChange={(e) => setConsigneeAddress(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Box legend */}
      {uniqueBoxNos.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-medium">Box groups:</span>
          {uniqueBoxNos.map((b) => (
            <span key={b} className={`rounded-full px-2.5 py-0.5 font-medium ${boxColourMap.get(b)?.replace("bg-white dark:bg-slate-900", "bg-slate-100 dark:bg-slate-800") ?? ""}`}>
              Box {b} ({lines.filter((l) => l.box_no === b).length} item{lines.filter((l) => l.box_no === b).length !== 1 ? "s" : ""})
            </span>
          ))}
        </div>
      )}

      {/* Line items table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[1300px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
              <th className="px-2 py-2 text-left">SL</th>
              <th className="px-2 py-2 text-left">Model No</th>
              <th className="px-2 py-2 text-left">Brand</th>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="px-2 py-2 text-left">Country</th>
              <th className="px-2 py-2 text-left">HS Code</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-center">Box #</th>
              <th className="px-2 py-2 text-right">CTNs</th>
              <th className="px-2 py-2 text-right">CBM</th>
              <th className="px-2 py-2 text-right">Weight kg</th>
              {mode === "invoice" && <th className="px-2 py-2 text-right">Unit Price</th>}
              {mode === "invoice" && <th className="px-2 py-2 text-right">Amount</th>}
              <th className="px-2 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {lines.map((ln, idx) => (
              <tr key={ln.key} className={`transition-colors ${boxColourMap.get(ln.box_no) ?? "bg-white dark:bg-slate-900"}`}>
                <td className="px-2 py-1.5 text-center text-xs text-slate-400">{idx + 1}</td>

                {/* Model No + autocomplete */}
                <td className="relative px-2 py-1.5">
                  <input
                    className={`w-32 ${cellInp} font-mono`}
                    value={ln.model_no}
                    placeholder="Model No"
                    onChange={(e) => { updateLine(ln.key, "model_no", e.target.value); searchSku(e.target.value, ln.key); }}
                    onFocus={() => { if (ln.model_no) searchSku(ln.model_no, ln.key); }}
                    onBlur={() => setTimeout(() => setSuggestions([]), 200)}
                  />
                  {activeLineKey === ln.key && suggestions.length > 0 && (
                    <div className="absolute left-2 top-full z-20 mt-0.5 w-80 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                      {suggestions.map((s) => (
                        <button key={s.id} type="button" onMouseDown={() => applySku(s, ln.key)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
                          <span className="mt-0.5 font-mono text-xs text-indigo-600">{s.model_no}</span>
                          <span className="flex-1 text-xs text-slate-500 line-clamp-1">{s.description}</span>
                        </button>
                      ))}
                      <button type="button"
                        onMouseDown={() => { setSuggestions([]); setSkuModal({ initial: { model_no: ln.model_no }, lineKey: ln.key }); }}
                        className="w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-slate-700">
                        + Add "{ln.model_no}" to catalog
                      </button>
                    </div>
                  )}
                  {!ln.model_no && (
                    <button type="button" onMouseDown={() => setSkuModal({ initial: {}, lineKey: ln.key })}
                      className="ml-1 text-xs text-indigo-500 hover:underline">+</button>
                  )}
                </td>

                <td className="px-2 py-1.5">
                  <input className={`w-24 ${cellInp}`} value={ln.brand} onChange={(e) => updateLine(ln.key, "brand", e.target.value)} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={`w-56 ${cellInp}`} value={ln.description} onChange={(e) => updateLine(ln.key, "description", e.target.value)} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={`w-16 ${cellInp}`} value={ln.country_of_origin} onChange={(e) => updateLine(ln.key, "country_of_origin", e.target.value)} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={`w-20 ${cellInp} font-mono`} value={ln.hs_code} onChange={(e) => updateLine(ln.key, "hs_code", e.target.value)} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min="1" step="1" className={`w-14 ${cellInp} text-right`} value={ln.qty}
                    onChange={(e) => updateLine(ln.key, "qty", e.target.value)} />
                </td>

                {/* Box # — warehouse editable */}
                <td className="px-2 py-1.5 text-center">
                  <input type="number" min="1" step="1" title="Box number — items with the same number share one carton"
                    className={`w-12 ${cellInp} text-center font-semibold text-indigo-600`}
                    value={ln.box_no}
                    onChange={(e) => updateLine(ln.key, "box_no", e.target.value)} />
                </td>

                {/* CTNs — editable by warehouse */}
                <td className="px-2 py-1.5">
                  <input type="number" min="0" step="1" title="Number of cartons (0 = merged into another box)"
                    className={`w-14 ${cellInp} text-right ${ln.no_of_ctns === 0 ? "text-slate-300 dark:text-slate-600" : ""}`}
                    value={ln.no_of_ctns}
                    onChange={(e) => updateLine(ln.key, "no_of_ctns", e.target.value)} />
                </td>

                {/* CBM — editable by warehouse (especially for merged boxes) */}
                <td className="px-2 py-1.5">
                  <input type="number" min="0" step="any" title="Total CBM for this line (enter measured box CBM for merged items)"
                    className={`w-20 ${cellInp} text-right`}
                    value={ln.tot_cbm || ""}
                    placeholder="0"
                    onChange={(e) => updateLine(ln.key, "tot_cbm", e.target.value)} />
                </td>

                <td className="px-2 py-1.5 text-right text-xs text-slate-500">{ln.total_weight_kg.toFixed(2)}</td>

                {mode === "invoice" && (
                  <td className="px-2 py-1.5">
                    <input type="number" min="0" step="any" className={`w-24 ${cellInp} text-right`}
                      value={ln.unit_price || ""} placeholder="0.00"
                      onChange={(e) => updateLine(ln.key, "unit_price", e.target.value)} />
                  </td>
                )}
                {mode === "invoice" && (
                  <td className="px-2 py-1.5 text-right text-xs font-medium text-slate-700 dark:text-slate-300">{fmt2(ln.amount)}</td>
                )}

                {/* Actions: up / down / merge-up / delete */}
                <td className="px-2 py-1.5">
                  <div className="flex items-center justify-center gap-0.5">
                    <button type="button" title="Move up" onClick={() => moveLine(ln.key, "up")}
                      className="rounded p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20"
                      disabled={idx === 0}>▲</button>
                    <button type="button" title="Move down" onClick={() => moveLine(ln.key, "down")}
                      className="rounded p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20"
                      disabled={idx === lines.length - 1}>▼</button>
                    <button type="button"
                      title="Merge into same box as row above (sets CTNs=0, enter CBM manually on primary item)"
                      onClick={() => mergeWithAbove(ln.key)}
                      disabled={idx === 0}
                      className="rounded p-0.5 text-slate-300 hover:text-indigo-500 disabled:opacity-20 text-xs font-bold">⊕</button>
                    <button type="button" title="Remove line" onClick={() => setLines((p) => p.filter((x) => x.key !== ln.key))}
                      className="rounded p-0.5 text-slate-300 hover:text-red-500">✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800/60">
              <td colSpan={6} className="px-2 py-2 text-right text-slate-500">Total</td>
              <td className="px-2 py-2 text-right">{lines.reduce((s, l) => s + l.qty, 0)}</td>
              <td />
              <td className="px-2 py-2 text-right">{totCtns}</td>
              <td className="px-2 py-2 text-right">{fmt5(totCBM)}</td>
              <td className="px-2 py-2 text-right">{totWeight.toFixed(2)}</td>
              {mode === "invoice" && <td />}
              {mode === "invoice" && <td className="px-2 py-2 text-right">{fmt2(subtotal)}</td>}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add line + VAT summary */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <button type="button" onClick={addLine}
          className="flex items-center gap-2 rounded-lg border border-dashed border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:border-indigo-500 hover:bg-indigo-50">
          + Add Line
        </button>
        {mode === "invoice" && (
          <div className="w-72 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium tabular-nums">AED {fmt2(subtotal)}</span>
              </div>
              <div className="flex justify-between text-amber-700 dark:text-amber-400">
                <span>VAT 5%</span>
                <span className="tabular-nums">AED {fmt2(vat)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold dark:border-slate-700">
                <span>Total</span>
                <span className="tabular-nums">AED {fmt2(grandTotal)}</span>
              </div>
              <p className="pt-1 text-xs italic text-slate-400">{aedToWords(grandTotal)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap gap-6 text-xs text-slate-500">
        {countries && <span>Country of Origin: {countries}</span>}
        <span>Total Cartons: {totCtns}</span>
        <span>Total CBM: {fmt5(totCBM)}</span>
        <span>Total Weight: {totWeight.toFixed(2)} kg</span>
        {COMPANY_INFO[company] && <span className="text-slate-400">— {COMPANY_INFO[company].name}</span>}
      </div>

      {/* Modals */}
      {skuModal && (
        <SkuModal initial={skuModal.initial} onClose={() => setSkuModal(null)}
          onSave={(sku) => { applySku(sku, skuModal.lineKey); setSkuModal(null); }} />
      )}
      {importPreview && (
        <ImportPreviewModal
          items={importPreview.items}
          onClose={() => setImportPreview(null)}
          onConfirm={confirmImport}
        />
      )}
    </div>
  );
}
