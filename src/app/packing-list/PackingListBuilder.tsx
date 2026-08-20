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

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

const TODAY = new Date().toISOString().slice(0, 10);

function newLine(): PackingLine {
  return {
    key: Math.random().toString(36).slice(2),
    model_no: "",
    brand: "",
    description: "",
    hs_code: "",
    country_of_origin: "China",
    qty: 1,
    no_of_ctns: 1,
    tot_cbm: 0,
    total_weight_kg: 0,
    unit_price: 0,
    amount: 0,
    _unit_weight_kg: null,
    _unit_cbm: null,
    _carton_qty: null,
    _carton_weight_kg: null,
    _carton_cbm: null,
  };
}

function fmt2(n: number) {
  return n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt5(n: number) {
  return n.toFixed(5).replace(/\.?0+$/, "");
}

interface SkuModalProps {
  initial: Partial<SkuCatalogRow>;
  onSave: (sku: SkuCatalogRow) => void;
  onClose: () => void;
}

function SkuModal({ initial, onSave, onClose }: SkuModalProps) {
  const [form, setForm] = useState<Partial<SkuCatalogRow>>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof SkuCatalogRow, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

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
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const labelCls = "block text-xs font-medium text-slate-500 mb-1";

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
          <div>
            <label className={labelCls}>Model No *</label>
            <input className={inputCls} value={form.model_no ?? ""} onChange={(e) => set("model_no", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Brand</label>
            <input className={inputCls} value={form.brand ?? ""} onChange={(e) => set("brand", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Description</label>
            <input className={inputCls} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>HS Code</label>
            <input className={inputCls} value={form.hs_code ?? ""} onChange={(e) => set("hs_code", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Country of Origin</label>
            <input className={inputCls} value={form.country_of_origin ?? "China"} onChange={(e) => set("country_of_origin", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Unit Weight (kg)</label>
            <input type="number" step="any" className={inputCls} value={form.unit_weight_kg ?? ""} onChange={(e) => set("unit_weight_kg", e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className={labelCls}>Unit CBM (m³)</label>
            <input type="number" step="any" className={inputCls} value={form.unit_cbm ?? ""} onChange={(e) => set("unit_cbm", e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className={labelCls}>Units per Carton</label>
            <input type="number" step="1" className={inputCls} value={form.carton_qty ?? ""} onChange={(e) => set("carton_qty", e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className={labelCls}>Carton Weight (kg)</label>
            <input type="number" step="any" className={inputCls} value={form.carton_weight_kg ?? ""} onChange={(e) => set("carton_weight_kg", e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className={labelCls}>Carton CBM (m³)</label>
            <input type="number" step="any" className={inputCls} value={form.carton_cbm ?? ""} onChange={(e) => set("carton_cbm", e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          {err && <p className="col-span-2 text-xs text-red-600">{err}</p>}
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save to Catalog"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
  const [lines, setLines] = useState<PackingLine[]>([newLine()]);

  // SKU autocomplete
  const [suggestions, setSuggestions] = useState<SkuCatalogRow[]>([]);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [skuModal, setSkuModal] = useState<{ initial: Partial<SkuCatalogRow>; lineKey: string } | null>(null);
  const suggestRef = useRef<NodeJS.Timeout | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Load existing if editId
  useEffect(() => {
    const id = editId ?? searchParams.get("edit");
    if (!id) return;
    getToken().then((token) => fetch(`/api/packing/lists/${id}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then((r) => r.json())
      .then((json) => {
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
          (json.items as PackingLine[]).map((item) => ({
            ...newLine(),
            ...item,
            key: Math.random().toString(36).slice(2),
          }))
        );
      })
      .catch(() => {});
  }, [editId, searchParams]);

  // Debounced SKU search
  const searchSku = useCallback(
    (q: string, lineKey: string) => {
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
    },
    []
  );

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
    setLines((prev) =>
      prev.map((ln) => {
        if (ln.key !== lineKey) return ln;
        const updated = { ...ln, [field]: field === "qty" || field === "unit_price" ? Number(raw) || 0 : raw };
        // Recalc physical if qty changed
        if (field === "qty") {
          const sku = {
            unit_weight_kg: ln._unit_weight_kg,
            unit_cbm: ln._unit_cbm,
            carton_qty: ln._carton_qty,
            carton_weight_kg: ln._carton_weight_kg,
            carton_cbm: ln._carton_cbm,
          };
          const phys = computePhysical(updated.qty, sku);
          return { ...updated, ...phys, amount: updated.qty * updated.unit_price };
        }
        if (field === "unit_price") {
          return { ...updated, amount: ln.qty * updated.unit_price };
        }
        return updated;
      })
    );
  }

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
          total_weight_kg: l.total_weight_kg,
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
      const savedId = id ?? json.id!;
      router.push(`/packing-list/${savedId}`);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {editId ?? searchParams.get("edit") ? "Edit Packing List" : "New Packing List"}
        </h1>
        <div className="flex gap-2">
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

      {saveErr && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveErr}</div>}

      {/* Company + Mode toggles */}
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
            <textarea rows={2} className={`${inputCls} resize-none`} placeholder="Address, City, Country" value={consigneeAddress} onChange={(e) => setConsigneeAddress(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Line items table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
              <th className="px-3 py-2 text-left">SL</th>
              <th className="px-3 py-2 text-left">Model No</th>
              <th className="px-3 py-2 text-left">Brand</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Country</th>
              <th className="px-3 py-2 text-left">HS Code</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">CTNs</th>
              <th className="px-3 py-2 text-right">CBM</th>
              <th className="px-3 py-2 text-right">Weight (kg)</th>
              {mode === "invoice" && <th className="px-3 py-2 text-right">Unit Price</th>}
              {mode === "invoice" && <th className="px-3 py-2 text-right">Amount</th>}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {lines.map((ln, idx) => (
              <tr key={ln.key} className="bg-white dark:bg-slate-900">
                <td className="px-3 py-1.5 text-center text-xs text-slate-400">{idx + 1}</td>
                {/* Model No with autocomplete */}
                <td className="relative px-3 py-1.5">
                  <input
                    className="w-32 rounded border border-slate-200 px-2 py-1 text-xs font-mono focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                    value={ln.model_no}
                    placeholder="Model No"
                    onChange={(e) => {
                      updateLine(ln.key, "model_no", e.target.value);
                      searchSku(e.target.value, ln.key);
                    }}
                    onFocus={() => { if (ln.model_no) searchSku(ln.model_no, ln.key); }}
                    onBlur={() => setTimeout(() => setSuggestions([]), 200)}
                  />
                  {activeLineKey === ln.key && suggestions.length > 0 && (
                    <div className="absolute left-3 top-full z-20 mt-0.5 w-80 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                      {suggestions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onMouseDown={() => applySku(s, ln.key)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <span className="mt-0.5 font-mono text-xs text-indigo-600">{s.model_no}</span>
                          <span className="flex-1 text-xs text-slate-500 line-clamp-1">{s.description}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onMouseDown={() => {
                          setSuggestions([]);
                          setSkuModal({ initial: { model_no: ln.model_no }, lineKey: ln.key });
                        }}
                        className="w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-slate-700"
                      >
                        + Add "{ln.model_no}" to catalog
                      </button>
                    </div>
                  )}
                  {!ln.model_no && (
                    <button type="button"
                      onMouseDown={() => setSkuModal({ initial: {}, lineKey: ln.key })}
                      className="ml-1 text-xs text-indigo-500 hover:underline">+</button>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <input className="w-24 rounded border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800" value={ln.brand} onChange={(e) => updateLine(ln.key, "brand", e.target.value)} />
                </td>
                <td className="px-3 py-1.5">
                  <input className="w-64 rounded border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800" value={ln.description} onChange={(e) => updateLine(ln.key, "description", e.target.value)} />
                </td>
                <td className="px-3 py-1.5">
                  <input className="w-20 rounded border border-slate-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800" value={ln.country_of_origin} onChange={(e) => updateLine(ln.key, "country_of_origin", e.target.value)} />
                </td>
                <td className="px-3 py-1.5">
                  <input className="w-24 rounded border border-slate-200 px-2 py-1 font-mono text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800" value={ln.hs_code} onChange={(e) => updateLine(ln.key, "hs_code", e.target.value)} />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" min="1" step="1" className="w-16 rounded border border-slate-200 px-2 py-1 text-right text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800" value={ln.qty} onChange={(e) => updateLine(ln.key, "qty", e.target.value)} />
                </td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-500">{ln.no_of_ctns}</td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-500">{fmt5(ln.tot_cbm)}</td>
                <td className="px-3 py-1.5 text-right text-xs text-slate-500">{ln.total_weight_kg.toFixed(2)}</td>
                {mode === "invoice" && (
                  <td className="px-3 py-1.5">
                    <input type="number" min="0" step="any" className="w-24 rounded border border-slate-200 px-2 py-1 text-right text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800" value={ln.unit_price || ""} placeholder="0.00" onChange={(e) => updateLine(ln.key, "unit_price", e.target.value)} />
                  </td>
                )}
                {mode === "invoice" && (
                  <td className="px-3 py-1.5 text-right text-xs font-medium text-slate-700 dark:text-slate-300">{fmt2(ln.amount)}</td>
                )}
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => setLines((p) => p.filter((x) => x.key !== ln.key))}
                    className="rounded p-1 text-slate-300 hover:text-red-500">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800/60">
              <td colSpan={6} className="px-3 py-2 text-right text-slate-500">Total</td>
              <td className="px-3 py-2 text-right">{lines.reduce((s, l) => s + l.qty, 0)}</td>
              <td className="px-3 py-2 text-right">{totCtns}</td>
              <td className="px-3 py-2 text-right">{fmt5(totCBM)}</td>
              <td className="px-3 py-2 text-right">{totWeight.toFixed(2)}</td>
              {mode === "invoice" && <td />}
              {mode === "invoice" && <td className="px-3 py-2 text-right">{fmt2(subtotal)}</td>}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add line + VAT section */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <button type="button" onClick={() => setLines((p) => [...p, newLine()])}
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

      {/* Country + carton summary */}
      <div className="flex gap-6 text-xs text-slate-500">
        {countries && <span>Country of Origin: {countries}</span>}
        <span>Total Cartons: {totCtns}</span>
        <span>Total CBM: {fmt5(totCBM)}</span>
        <span>Total Weight: {totWeight.toFixed(2)} kg</span>
      </div>

      {/* SKU modal */}
      {skuModal && (
        <SkuModal
          initial={skuModal.initial}
          onClose={() => setSkuModal(null)}
          onSave={(sku) => {
            applySku(sku, skuModal.lineKey);
            setSkuModal(null);
          }}
        />
      )}
    </div>
  );
}
