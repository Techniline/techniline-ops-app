"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

import { btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { formatAED } from "@/lib/format";
import type { ReturnImportRow, ReturnImportSummary } from "@/app/api/amazon/return-items-import/route";

const REASON_TO_TYPE: Record<string, string> = {
  "overstock": "vendor_return",
  "defective": "return_dispute",
  "damaged by carrier": "return_dispute",
  "vendor damaged": "vendor_return",
};

function parseReturnDate(raw: unknown): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY (UAE format used in Amazon Vendor Central CSV)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function parseAmount(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

export function parseReturnItemsCsv(sheetRows: unknown[][]): ReturnImportRow[] {
  if (!sheetRows || sheetRows.length < 2) return [];

  // Find header row by looking for "return id"
  let hi = sheetRows.findIndex((r) => r.some((c) => norm(c) === "return id"));
  if (hi < 0) hi = 0;
  const header = sheetRows[hi].map(norm);

  const col = (...names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };

  const cReturnId   = col("return id");
  const cShipReqId  = col("shipment request id");
  const cAuthId     = col("authorization id");
  const cDate       = col("return date");
  const cReason     = col("reason");
  const cTracking   = col("tracking number");
  const cPo         = col("purchase order");
  const cWarehouse  = col("warehouse");
  const cAsin       = col("asin");
  const cProduct    = col("product");
  const cQty        = col("quantity");
  const cTotal      = col("total amount");
  const cCostPer    = col("cost per unit");

  if (cReturnId < 0) return [];

  // Collect raw lines, deduplicate exact duplicates
  type RawLine = {
    returnId: string; vretNumber: string | null; authId: string | null;
    date: string; reason: string; tracking: string | null; po: string | null;
    warehouse: string | null; asin: string | null; product: string | null;
    qty: number; total: number;
  };
  const seen = new Set<string>();
  const lines: RawLine[] = [];

  for (let i = hi + 1; i < sheetRows.length; i++) {
    const r = sheetRows[i];
    if (!r || r.length === 0) continue;
    const returnId = String(r[cReturnId] ?? "").trim();
    if (!returnId) continue;

    const asin    = cAsin >= 0 ? (String(r[cAsin] ?? "").trim() || null) : null;
    const po      = cPo >= 0 ? (String(r[cPo] ?? "").trim() || null) : null;
    const qty     = cQty >= 0 ? Math.abs(Math.round(parseAmount(r[cQty]))) : 1;
    const total   = cTotal >= 0 ? parseAmount(r[cTotal]) : (cCostPer >= 0 ? parseAmount(r[cCostPer]) * qty : 0);

    // Dedup key: returnId + asin + po + total (to catch exact CSV duplicates)
    const key = `${returnId}|${asin ?? ""}|${po ?? ""}|${total}`;
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push({
      returnId,
      vretNumber: cShipReqId >= 0 ? (String(r[cShipReqId] ?? "").trim() || null) : null,
      authId:     cAuthId >= 0 ? (String(r[cAuthId] ?? "").trim() || null) : null,
      date:       cDate >= 0 ? parseReturnDate(r[cDate]) : new Date().toISOString().slice(0, 10),
      reason:     cReason >= 0 ? String(r[cReason] ?? "").trim() : "",
      tracking:   cTracking >= 0 ? (String(r[cTracking] ?? "").trim() || null) : null,
      po,
      warehouse:  cWarehouse >= 0 ? (String(r[cWarehouse] ?? "").trim() || null) : null,
      asin,
      product:    cProduct >= 0 ? (String(r[cProduct] ?? "").trim() || null) : null,
      qty,
      total,
    });
  }

  // Group by Return ID
  const byId = new Map<string, RawLine[]>();
  for (const l of lines) {
    const existing = byId.get(l.returnId) ?? [];
    existing.push(l);
    byId.set(l.returnId, existing);
  }

  const out: ReturnImportRow[] = [];
  for (const [returnId, group] of byId) {
    const first = group[0];
    const totalCost = group.reduce((s, l) => s + l.total, 0);
    const totalQty  = group.reduce((s, l) => s + l.qty, 0);
    const returnType = REASON_TO_TYPE[first.reason.toLowerCase()] ?? "vendor_return";
    // Pick the most expensive item as the primary SKU
    const primary = group.reduce((best, l) => (l.total > best.total ? l : best), first);
    const sku = primary.product ? primary.product.slice(0, 200) : (primary.asin ?? null);

    out.push({
      return_id:       returnId,
      vret_number:     first.vretNumber,
      authorization_id: first.authId,
      date_received:   first.date,
      return_type:     returnType,
      tracking_number: first.tracking,
      po_number:       first.po,
      warehouse:       first.warehouse,
      total_cost_aed:  Math.round(totalCost * 100) / 100,
      qty:             totalQty,
      model_sku:       sku,
    });
  }

  return out;
}

export function ImportReturnItemsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [rows, setRows]         = useState<ReturnImportRow[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [parsing, setParsing]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [summary, setSummary]   = useState<ReturnImportSummary | null>(null);

  async function onFiles(files: FileList) {
    setError(null); setSummary(null); setRows([]); setFileNames([]);
    setParsing(true);
    try {
      const names: string[] = [];
      const allRows: ReturnImportRow[] = [];
      const seenIds = new Set<string>();

      for (const file of Array.from(files)) {
        names.push(file.name);
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
        for (const row of parseReturnItemsCsv(sheet)) {
          if (!seenIds.has(row.return_id)) {
            seenIds.add(row.return_id);
            allRows.push(row);
          }
        }
      }

      setFileNames(names);
      setRows(allRows);
      if (allRows.length === 0) setError("No return rows found. Expected columns: Return ID, Shipment Request ID, Return date, Reason, Total amount.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file(s).");
    } finally {
      setParsing(false);
    }
  }

  const totalValue = rows.reduce((s, r) => s + r.total_cost_aed, 0);
  const byType = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.return_type] = (acc[r.return_type] ?? 0) + 1; return acc;
  }, {});

  async function doImport() {
    setError(null); setImporting(true);
    try {
      const { supabase } = await import("@/lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in.");
      const res = await fetch("/api/amazon/return-items-import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; summary?: ReturnImportSummary; error?: string };
      if (!res.ok || !j.ok || !j.summary) throw new Error(j.error ?? `HTTP ${res.status}`);
      setSummary(j.summary);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import Amazon Return Items</h3>
        <p className="mb-4 mt-0.5 text-xs text-slate-500">
          Upload one or more "Return Items" CSV exports from Vendor Central. Items are grouped by Return ID, totals aggregated, and upserted into the returns log.
        </p>

        {!summary ? (
          <>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              onChange={(e) => { if (e.target.files?.length) void onFiles(e.target.files); }}
              className={inputClass}
            />

            {parsing ? (
              <p className="mt-3 text-sm text-slate-500">Reading {fileNames.length > 0 ? fileNames.join(", ") : "files"}…</p>
            ) : null}

            {!parsing && rows.length > 0 ? (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <div className="flex justify-between"><span className="text-slate-500">Files</span><span className="font-semibold">{fileNames.length}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Unique returns</span><span className="font-semibold">{rows.length}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Vendor returns</span><span className="font-semibold">{byType["vendor_return"] ?? 0}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Return disputes</span><span className="font-semibold">{byType["return_dispute"] ?? 0}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Total cost</span><span className="font-semibold">{formatAED(totalValue)}</span></div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">✓ Imported {summary.parsed} return rows.</p>
            <ul className="mt-2 space-y-0.5 text-emerald-900 dark:text-emerald-200">
              <li>{summary.created} created · {summary.updated} updated · {summary.skipped} unchanged</li>
              {summary.deductionsCreated > 0 ? (
                <li>{summary.deductionsCreated} remittance breakdown line{summary.deductionsCreated !== 1 ? "s" : ""} linked</li>
              ) : null}
            </ul>
            {summary.errors.length > 0 ? (
              <details className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                <summary className="cursor-pointer">{summary.errors.length} error(s)</summary>
                <ul className="mt-1 list-disc pl-4">{summary.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>
              </details>
            ) : null}
          </div>
        )}

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>{summary ? "Done" : "Cancel"}</button>
          {!summary ? (
            <button type="button" onClick={() => void doImport()} disabled={importing || rows.length === 0} className={btnPrimary}>
              {importing ? "Importing…" : `Import ${rows.length || ""}`.trim()}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
