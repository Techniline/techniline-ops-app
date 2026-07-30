"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

import { btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { formatAED } from "@/lib/format";
import type { PaymentImportPayment, PaymentImportSummary } from "@/app/api/amazon/payments-import/route";

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  // D/M/YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseAmt(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

export function parsePaymentsXlsx(sheetRows: unknown[][]): PaymentImportPayment[] {
  if (!sheetRows || sheetRows.length < 2) return [];

  // Find the header row — the one that contains "payment number"
  let hi = sheetRows.findIndex((r) => r.some((c) => norm(c) === "payment number"));
  if (hi < 0) return [];
  const header = sheetRows[hi].map(norm);

  const cPayNum  = header.indexOf("payment number");
  const cPayDate = header.indexOf("payment date");
  // "amount in invoice currency" is the net paid amount in these exports
  const cAmount  = header.findIndex((h) => h.includes("amount in invoice currency") || h === "net amount");
  const cStatus  = header.findIndex((h) => h.includes("payment status") || h === "status");

  if (cPayNum < 0) return [];

  const out: PaymentImportPayment[] = [];
  for (let i = hi + 1; i < sheetRows.length; i++) {
    const r = sheetRows[i];
    if (!r || r.length === 0) continue;
    const payNum = String(r[cPayNum] ?? "").trim();
    if (!payNum || !/^\d{6,}$/.test(payNum)) continue;

    if (cStatus >= 0) {
      const status = norm(r[cStatus] ?? "");
      if (status && status !== "successful") continue; // skip voided/failed
    }

    out.push({
      paymentNumber: payNum,
      paymentDate: cPayDate >= 0 ? toIsoDate(r[cPayDate]) : null,
      netPaidAed: cAmount >= 0 ? parseAmt(r[cAmount]) : null,
      lines: [], // these files have no invoice-level breakdown
    });
  }
  return out;
}

export function ImportPaymentsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [payments, setPayments]   = useState<PaymentImportPayment[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [parsing, setParsing]     = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [summary, setSummary]     = useState<PaymentImportSummary | null>(null);

  async function onFiles(files: FileList) {
    setError(null); setSummary(null); setPayments([]); setFileNames([]);
    setParsing(true);
    try {
      const names: string[] = [];
      const seen = new Set<string>();
      const all: PaymentImportPayment[] = [];

      for (const file of Array.from(files)) {
        names.push(file.name);
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
        for (const p of parsePaymentsXlsx(sheet)) {
          if (!seen.has(p.paymentNumber)) { seen.add(p.paymentNumber); all.push(p); }
        }
      }

      setFileNames(names);
      setPayments(all);
      if (all.length === 0) setError("No payment rows found. Expected an Amazon Vendor Central Payments export with a 'Payment Number' column.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file(s).");
    } finally {
      setParsing(false);
    }
  }

  const totalAed = payments.reduce((s, p) => s + (p.netPaidAed ?? 0), 0);

  async function doImport() {
    setError(null); setImporting(true);
    try {
      const { supabase } = await import("@/lib/supabaseClient");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in.");
      const res = await fetch("/api/amazon/payments-import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ payments }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; summary?: PaymentImportSummary; error?: string };
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
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import Amazon Payments</h3>
        <p className="mb-4 mt-0.5 text-xs text-slate-500">
          Upload "Payments" xlsx exports from Vendor Central. Creates remittance records for any payments the email system missed. Note: line-level breakdown only comes from the remittance advice email.
        </p>

        {!summary ? (
          <>
            <input
              type="file"
              accept=".xlsx,.xls"
              multiple
              onChange={(e) => { if (e.target.files?.length) void onFiles(e.target.files); }}
              className={inputClass}
            />
            {parsing ? <p className="mt-3 text-sm text-slate-500">Reading files…</p> : null}
            {!parsing && payments.length > 0 ? (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <div className="flex justify-between"><span className="text-slate-500">Files</span><span className="font-semibold">{fileNames.length}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Payments found</span><span className="font-semibold">{payments.length}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Total amount</span><span className="font-semibold">{formatAED(totalAed)}</span></div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">✓ Import complete.</p>
            <ul className="mt-2 space-y-0.5 text-emerald-900 dark:text-emerald-200">
              <li>{summary.paymentsCreated} new payments created</li>
              <li>{summary.paymentsUpdated} existing payments updated</li>
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
            <button type="button" onClick={() => void doImport()} disabled={importing || payments.length === 0} className={btnPrimary}>
              {importing ? "Importing…" : payments.length > 0 ? `Import ${payments.length} payments` : "Import"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
