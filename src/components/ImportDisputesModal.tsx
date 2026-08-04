"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

import { btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { formatAED } from "@/lib/format";
import {
  parseDisputeReportSheet,
  type DisputeReportRow,
  type ImportSummary,
} from "@/lib/amazon-actions/importDisputes";
import { supabase } from "@/lib/supabaseClient";

/** Manager/finance: upload the Amazon "Disputes" export (xlsx/csv) to reconcile
 *  dispute statuses + approved amounts and auto-close resolved dispute Actions. */
export function ImportDisputesModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [rows, setRows] = useState<DisputeReportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function onFile(file: File) {
    setError(null);
    setSummary(null);
    setRows([]);
    setFileName(file.name);
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const sheet = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
      const parsed = parseDisputeReportSheet(sheet);
      if (parsed.length === 0) {
        setError("No dispute rows found. Expected columns like “Dispute ID”, “Dispute status”, “Approved Amount”.");
      }
      setRows(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setParsing(false);
    }
  }

  // Preview breakdown.
  const resolved = rows.filter((r) => /resolv|approv|credit|paid|complete/i.test(r.status)).length;
  const rejected = rows.filter((r) => /reject|denied|declin/i.test(r.status)).length;
  const other = rows.length - resolved - rejected;
  const totalApproved = rows.reduce((s, r) => s + (r.approvedAed ?? 0), 0);

  async function doImport() {
    setError(null);
    setImporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in.");
      const res = await fetch("/api/amazon/disputes-import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; summary?: ImportSummary; error?: string };
      if (!res.ok || !j.ok || !j.summary) throw new Error(j.error ?? `HTTP ${res.status}`);
      setSummary(j.summary);
      onImported(); // refresh the actions feed behind the modal
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import Amazon dispute report</h3>
        <p className="mb-4 mt-0.5 text-xs text-slate-500">
          Upload the “Disputes” export (xlsx or csv) from Vendor Central. Statuses and approved amounts are applied to your dispute records, and resolved disputes auto-close their Amazon Action.
        </p>

        {!summary ? (
          <>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              className={inputClass}
            />

            {parsing ? <p className="mt-3 text-sm text-slate-500">Reading {fileName}…</p> : null}

            {!parsing && rows.length > 0 ? (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <div className="flex justify-between"><span className="text-slate-500">Rows found</span><span className="font-semibold">{rows.length}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Resolved / Rejected / Other</span><span className="font-semibold">{resolved} · {rejected} · {other}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-slate-500">Total approved</span><span className="font-semibold">{formatAED(totalApproved)}</span></div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">✓ Imported {summary.parsed} dispute rows.</p>
            <ul className="mt-2 space-y-0.5 text-emerald-900 dark:text-emerald-200">
              <li>{summary.disputesCreated} created · {summary.disputesUpdated} updated · {summary.disputesUnchanged} unchanged</li>
              <li>{summary.actionsClosed} Amazon Action(s) auto-closed</li>
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
