"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CustomizableTable } from "@/components/logistics/CustomizableTable";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import { parseDocPdf } from "@/lib/logistics/manual";
import {
  CHANNELS,
  CONDITIONS,
  DOC_STATUS,
  PHYSICAL_STATUS,
  RETURN_REASONS,
  deleteReturn,
  fetchAuditLog,
  fetchReturns,
  importAmazonReturns,
  importReturnsXml,
  itemCount,
  notifyReturnLogged,
  parseReturnsXml,
  readItems,
  rLabel,
  saveReturn,
  syncReturnsFromAmazon,
  uploadReturnImages,
  type AuditEntry,
  type ReturnFilters,
  type ReturnImportSummary,
  type ReturnItem,
  type ReturnRow,
  type ReturnSyncResult,
  type XmlReturnRow,
} from "@/lib/logistics/marketplace";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

// ─── ImportReturnsModal ────────────────────────────────────────────────────────

function ImportReturnsModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReturnImportSummary | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function run(apply: boolean) {
    if (!file) { setErr("Choose the Amazon delivery list (.xlsx) first."); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await importAmazonReturns(file, apply);
      setSummary(r.summary);
      if (apply) { setDone(r.inserted ?? 0); onApplied(); }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import returns from delivery list</h2>
            <p className="text-xs text-slate-500">Logs return rows (return date / PRT / SRT / cancelled) channelled by sheet, as closed historical records.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); setDone(null); }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:text-slate-300 dark:file:bg-slate-800"
          />
          {err ? <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}
          {summary ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="grid grid-cols-2 gap-y-1">
                <span className="text-slate-500">Return rows found</span><span className="text-right font-medium">{summary.returnRows}</span>
                <span className="text-slate-500">{done == null ? "Will log" : "Logged"}</span><span className="text-right font-medium text-emerald-600">{done ?? summary.willInsert}</span>
                <span className="text-slate-500">Already logged (skipped)</span><span className="text-right font-medium text-amber-600">{summary.alreadyExists}</span>
              </div>
              {Object.keys(summary.byChannel).length ? (
                <p className="mt-2 text-xs text-slate-400">By channel: {Object.entries(summary.byChannel).map(([k, v]) => `${rLabel(CHANNELS, k)} ${v}`).join(" · ")}</p>
              ) : null}
              {done != null ? <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">✓ Logged {done} return(s).</p> : null}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={busy}>Close</button>
          {done == null ? (
            <>
              <button type="button" onClick={() => run(false)} className={btnSecondary} disabled={busy || !file}>{busy ? "Working…" : "Preview"}</button>
              <button type="button" onClick={() => run(true)} className={btnPrimary} disabled={busy || !summary || summary.willInsert === 0}>{busy ? "Working…" : `Apply${summary ? ` (${summary.willInsert})` : ""}`}</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── XmlImportModal ───────────────────────────────────────────────────────────

function XmlImportModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [records, setRecords] = useState<XmlReturnRow[]>([]);
  const [preview, setPreview] = useState<{ willInsert: number; willUpdate: number; alreadyExists: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inserted: number; updated: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    setPreview(null);
    setDone(null);
    try {
      const parsed: XmlReturnRow[] = [];
      for (const file of files) {
        const text = await file.text();
        parsed.push(...parseReturnsXml(text));
      }
      if (!parsed.length) { setErr("No return records found in the selected file(s)."); setBusy(false); return; }
      setRecords(parsed);
      const result = await importReturnsXml(parsed, false);
      setPreview(result);
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setErr(null);
    try {
      const result = await importReturnsXml(records, true);
      setDone({ inserted: result.inserted, updated: result.updated });
      onApplied();
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import Amazon returns XML</h2>
            <p className="text-xs text-slate-500">Download the Returns Report from Amazon Seller Central → Reports → Fulfillment → Returns. Select one or multiple XML files.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <input
            type="file"
            accept=".xml"
            multiple
            disabled={busy || !!done}
            onChange={handleFiles}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:text-slate-300 dark:file:bg-slate-800"
          />
          {err ? <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}
          {busy && !preview ? <p className="text-sm text-slate-500">Parsing…</p> : null}
          {preview && !done ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="grid grid-cols-2 gap-y-1">
                <span className="text-slate-500">Returns found</span><span className="text-right font-medium">{records.length}</span>
                <span className="text-slate-500">Will create</span><span className="text-right font-medium text-emerald-600">{preview.willInsert}</span>
                <span className="text-slate-500">Will update (add Return ID)</span><span className="text-right font-medium text-blue-600">{preview.willUpdate}</span>
                <span className="text-slate-500">Already in system (skipped)</span><span className="text-right font-medium text-amber-600">{preview.alreadyExists}</span>
              </div>
            </div>
          ) : null}
          {done ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✓ {done.inserted} record(s) created, {done.updated} existing record(s) updated with Return ID.
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={busy}>Close</button>
          {preview && !done ? (
            <button
              type="button"
              onClick={() => void apply()}
              className={btnPrimary}
              disabled={busy || (preview.willInsert === 0 && preview.willUpdate === 0)}
            >
              {busy ? "Importing…" : `Import (${preview.willInsert + preview.willUpdate})`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── SrtImportModal ───────────────────────────────────────────────────────────

function SrtImportModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ willUpdate: number; alreadySet: number; notFound: number; total: number } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await (await import("@/lib/supabaseClient")).supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in.");
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/logistics/srt-import?apply=${apply ? "1" : "0"}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || j.ok !== true) throw new Error((j.error as string) ?? `HTTP ${res.status}`);
      if (apply) { setDone(j.updated as number); onApplied(); }
      else setPreview(j as typeof preview);
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import SRT numbers from Excel</h2>
            <p className="text-xs text-slate-500">Upload the SRT Amazon Seller ledger. SRT numbers will be matched to returns by the order number in the Comment column.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy || done != null}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setDone(null); }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:text-slate-300 dark:file:bg-slate-800"
          />
          {err ? <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}
          {preview && done == null ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="grid grid-cols-2 gap-y-1">
                <span className="text-slate-500">SRT rows found</span><span className="text-right font-medium">{preview.total}</span>
                <span className="text-slate-500">Will update</span><span className="text-right font-medium text-emerald-600">{preview.willUpdate}</span>
                <span className="text-slate-500">Already have SRT (skipped)</span><span className="text-right font-medium text-amber-600">{preview.alreadySet}</span>
                <span className="text-slate-500">Order not in system</span><span className="text-right font-medium text-slate-400">{preview.notFound}</span>
              </div>
            </div>
          ) : null}
          {done != null ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✓ SRT number filled in for {done} return record(s).
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary} disabled={busy}>Close</button>
          {done == null ? (
            <>
              <button type="button" onClick={() => void run(false)} className={btnSecondary} disabled={busy || !file}>{busy && !preview ? "Checking…" : "Preview"}</button>
              <button type="button" onClick={() => void run(true)} className={btnPrimary} disabled={busy || !preview || preview.willUpdate === 0}>{busy && preview ? "Importing…" : `Apply${preview ? ` (${preview.willUpdate})` : ""}`}</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── DocBadge ─────────────────────────────────────────────────────────────────

function DocBadge({ value }: { value: string }) {
  const tone =
    value === "credited" || value === "closed"
      ? "bg-emerald-100 text-emerald-700"
      : value === "rejected"
        ? "bg-rose-100 text-rose-700"
        : value === "pending"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{rLabel(DOC_STATUS, value)}</span>;
}

// ─── AuditModal ───────────────────────────────────────────────────────────────

const TRACKED: { key: string; label: string }[] = [
  { key: "physical_status", label: "Physical status" },
  { key: "doc_status", label: "Doc status" },
  { key: "serial_number", label: "Serial #" },
  { key: "serial_number_skipped", label: "Serial skipped" },
  { key: "notes", label: "Notes" },
  { key: "claim_amount", label: "Claim amount" },
  { key: "credit_note_no", label: "Credit note" },
  { key: "srt_number", label: "SRT" },
  { key: "prt_number", label: "PRT" },
  { key: "dispute_id", label: "Dispute ID" },
  { key: "case_id", label: "Case ID" },
  { key: "doc_remarks", label: "Doc remarks" },
  { key: "reason", label: "Reason" },
  { key: "received_date", label: "Return date" },
  { key: "return_ref", label: "Return ID" },
  { key: "order_ref", label: "Order #" },
  { key: "channel", label: "Channel" },
  { key: "image_urls", label: "Images" },
];

function diffEntries(curr: unknown, prev: unknown): string[] {
  if (!prev) return [];
  const c = (curr ?? {}) as Record<string, unknown>;
  const p = (prev ?? {}) as Record<string, unknown>;
  return TRACKED
    .filter(({ key }) => JSON.stringify(c[key]) !== JSON.stringify(p[key]))
    .map(({ label }) => label);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AE", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function AuditModal({ returnId, returnRef, onClose }: { returnId: string; returnRef: string | null; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAuditLog(returnId)
      .then(setEntries)
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false));
  }, [returnId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className={`${surface} w-full max-w-lg`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Change history</h2>
            {returnRef ? <p className="text-xs text-slate-500">{returnRef}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="min-h-[8rem] px-5 py-4">
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
          {err ? <p className="text-sm text-rose-600">{err}</p> : null}
          {!loading && !err && entries.length === 0 ? <p className="text-sm text-slate-500">No history recorded yet.</p> : null}
          {entries.length > 0 ? (
            <ol className="relative space-y-5 border-l-2 border-slate-200 pl-5 dark:border-slate-700">
              {entries.map((e, i) => {
                const changes = diffEntries(e.snapshot, entries[i + 1]?.snapshot);
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[1.45rem] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-slate-400 dark:border-slate-900 dark:bg-slate-500" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-slate-400">{fmtDate(e.changed_at)}</span>
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {e.action === "created" ? "Created" : "Updated"}{" "}
                        <span className="font-normal text-slate-500">by</span>{" "}
                        {e.changed_by_name ?? "Unknown"}
                      </span>
                      {changes.length > 0 ? (
                        <span className="text-xs text-slate-500">Changed: {changes.join(", ")}</span>
                      ) : e.action !== "created" ? (
                        <span className="text-xs italic text-slate-400">Minor update</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
        <div className="flex justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface PendingImage {
  file: File;
  previewUrl: string;
}

type Draft = Partial<ReturnRow>;
const EMPTY: Draft = { physical_status: "received", doc_status: "pending" };
const EMPTY_ITEM: ReturnItem = { sku: null, product: null, qty: 1, condition: null };
const MAX_ITEMS = 10;
const MAX_IMAGES = 5;

export default function MarketplaceReturnsPage() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [products, setProducts] = useState<ReturnItem[]>([{ ...EMPTY_ITEM }]);
  const [serialNumber, setSerialNumber] = useState("");
  const [serialSkipped, setSerialSkipped] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingXml, setImportingXml] = useState(false);
  const [importingSrt, setImportingSrt] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<ReturnSyncResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [auditReturnId, setAuditReturnId] = useState<string | null>(null);
  const [auditReturnRef, setAuditReturnRef] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);

  // Auto-open the new-return form pre-filled when navigated from Noon returns (?prefill=1&...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("prefill") !== "1") return;
    const ch = p.get("channel") ?? "";
    const rr = p.get("return_ref") ?? "";
    const or = p.get("order_ref") ?? "";
    const sku = p.get("sku") ?? "";
    const product = p.get("product") ?? "";
    const rd = p.get("return_date") ?? "";
    setDraft({ ...EMPTY, channel: ch || undefined, return_ref: rr || undefined, order_ref: or || undefined, received_date: rd || undefined });
    setProducts([{ sku: sku || null, product: product || null, qty: 1, condition: null }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDraft(d: Draft) {
    pendingImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    const r = d as ReturnRow;
    setProducts(d.id ? readItems(r) : [{ ...EMPTY_ITEM }]);
    setSerialNumber(r.serial_number ?? "");
    setSerialSkipped(r.serial_number_skipped ?? false);
    setPendingImages([]);
    setUploadedImageUrls(r.image_urls ?? []);
    setErr(null);
    setMsg(null);
    setDraft(d);
  }

  const setItem = (i: number, k: keyof ReturnItem, v: unknown) =>
    setProducts((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  const addItem = () => setProducts((ps) => (ps.length >= MAX_ITEMS ? ps : [...ps, { ...EMPTY_ITEM }]));
  const removeItem = (i: number) => setProducts((ps) => (ps.length <= 1 ? ps : ps.filter((_, idx) => idx !== i)));

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const canAdd = MAX_IMAGES - uploadedImageUrls.length - pendingImages.length;
    const toAdd = files.slice(0, canAdd);
    const newPending: PendingImage[] = toAdd.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setPendingImages((prev) => [...prev, ...newPending]);
    e.target.value = "";
  }

  function removePendingImage(i: number) {
    setPendingImages((prev) => {
      URL.revokeObjectURL(prev[i].previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  function removeUploadedImage(i: number) {
    setUploadedImageUrls((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function uploadDoc(file: File) {
    setParsing(true);
    setErr(null);
    setMsg(null);
    try {
      const d = await parseDocPdf(file);
      setDraft((cur) => ({
        ...(cur ?? { ...EMPTY }),
        order_ref: cur?.order_ref || d.poNumber || d.invoiceNumber || d.doNumber || cur?.order_ref,
      }));
      if (d.items.length) {
        setProducts(d.items.map((i) => ({ sku: i.sku, product: i.description, qty: i.qty ?? 1, condition: null })).slice(0, MAX_ITEMS));
      }
      setMsg(
        d.engine === "basic"
          ? "Captured the order number from the document — add product lines manually."
          : `Captured ${d.items.length} product line(s) from the document — review and complete.`
      );
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setParsing(false);
    }
  }

  const [channel, setChannel] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("channel_filter") ?? "";
  });
  const [docPending, setDocPending] = useState(false);
  const [search, setSearch] = useState("");

  const filters: ReturnFilters = useMemo(
    () => ({ channel: channel || undefined, docPending: docPending || undefined, search }),
    [channel, docPending, search]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchReturns(filters));
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const set = (k: keyof ReturnRow, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  async function save() {
    if (!draft) return;
    if (!draft.channel) { setErr("Choose a channel."); return; }
    if (!serialSkipped && !serialNumber.trim()) {
      setErr('Enter the serial number, or tick "Box / device not received" to skip.');
      return;
    }
    const clean = products.filter((p) => (p.sku ?? "").trim() || (p.product ?? "").trim());
    if (clean.length === 0) { setErr("Add at least one product (SKU or product name)."); return; }

    setBusy(true);
    setErr(null);
    try {
      const isNew = !draft.id;
      const returnId = draft.id ?? crypto.randomUUID();

      let allImageUrls = [...uploadedImageUrls];
      if (pendingImages.length > 0) {
        const newUrls = await uploadReturnImages(returnId, pendingImages.map((p) => p.file));
        allImageUrls = [...uploadedImageUrls, ...newUrls];
      }

      const totalQty = clean.reduce((s, p) => s + (Number(p.qty) || 0), 0);
      const payload: Draft = {
        ...draft,
        id: returnId,
        items: clean as unknown as Draft["items"],
        sku: clean[0].sku,
        product: clean[0].product,
        condition: clean[0].condition,
        qty: totalQty || clean[0].qty || 1,
        serial_number: serialSkipped ? null : serialNumber.trim() || null,
        serial_number_skipped: serialSkipped,
        image_urls: allImageUrls,
      };

      const saved = await saveReturn(payload);
      if (isNew) void notifyReturnLogged(saved);
      setDraft(null);
      setMsg(isNew ? "Return logged — Maricel notified for documentation." : "Saved.");
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this return record?")) return;
    setBusy(true);
    try {
      await deleteReturn(id);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncFromAmazon() {
    setSyncing(true);
    setSyncResult(null);
    setErr(null);
    setMsg(null);
    try {
      const result = await syncReturnsFromAmazon();
      setSyncResult(result);
      if (result.created > 0 || result.updated > 0) await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSyncing(false);
    }
  }

  const totalImages = uploadedImageUrls.length + pendingImages.length;

  return (
    <LogisticsShell
      title="Marketplace Returns"
      subtitle="Warehouse-logged returns (Amazon DF / Seller / Flex, Noon, Cocoblu) + documentation."
      page="marketplace"
      wide
      actions={
        <div className="flex items-center gap-2">
          <button type="button" className={btnSecondary} onClick={() => setImporting(true)}>Import from delivery list</button>
          <button type="button" className={btnSecondary} onClick={() => setImportingXml(true)}>Import Amazon XML</button>
          <button type="button" className={btnSecondary} onClick={() => setImportingSrt(true)}>Import SRT numbers</button>
          <button type="button" className={btnSecondary} onClick={() => void syncFromAmazon()} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync from Amazon"}
          </button>
          <button type="button" className={btnPrimary} onClick={() => openDraft({ ...EMPTY })}>+ Log return</button>
        </div>
      }
    >
      {importing ? <ImportReturnsModal onClose={() => setImporting(false)} onApplied={() => void load()} /> : null}
      {importingXml ? <XmlImportModal onClose={() => setImportingXml(false)} onApplied={() => void load()} /> : null}
      {importingSrt ? <SrtImportModal onClose={() => setImportingSrt(false)} onApplied={() => void load()} /> : null}

      {auditReturnId ? (
        <AuditModal
          returnId={auditReturnId}
          returnRef={auditReturnRef}
          onClose={() => { setAuditReturnId(null); setAuditReturnRef(null); }}
        />
      ) : null}

      {msg ? <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div> : null}
      {syncResult ? (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Sync complete — {syncResult.created} new return(s) created, {syncResult.updated} record(s) updated with product info.
          {syncResult.created === 0 && syncResult.updated === 0 ? " Everything is already up to date." : ""}
          <button type="button" className="ml-3 text-emerald-600 underline" onClick={() => setSyncResult(null)}>Dismiss</button>
        </div>
      ) : null}
      {err && !draft ? <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

      {draft ? (
        <div className={`${surface} mb-4 p-4`}>
          {/* Header */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {draft.id ? "Edit return" : "Log new return"}
            </h2>
            <label className={`${parsing ? "pointer-events-none opacity-60" : ""} cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800`}>
              {parsing ? "Reading…" : "📎 Upload PDF (auto-fill)"}
              <input type="file" accept="application/pdf" className="hidden" disabled={parsing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadDoc(f); e.target.value = ""; }} />
            </label>
          </div>

          {/* Return details */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select className={inputClass} value={draft.channel ?? ""} onChange={(e) => set("channel", e.target.value)}>
              <option value="">Channel…</option>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input className={inputClass} placeholder="Return ID" value={draft.return_ref ?? ""} onChange={(e) => set("return_ref", e.target.value)} />
            <input className={inputClass} placeholder="Order number" value={draft.order_ref ?? ""} onChange={(e) => set("order_ref", e.target.value)} />
            <select className={inputClass} value={draft.reason ?? ""} onChange={(e) => set("reason", e.target.value)}>
              <option value="">Reason…</option>
              {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <label className="flex flex-col gap-1 text-xs text-slate-500">Return date
              <input className={inputClass} type="date" value={draft.received_date ?? ""} onChange={(e) => set("received_date", e.target.value || null)} />
            </label>
            <select className={inputClass} value={draft.physical_status ?? "received"} onChange={(e) => set("physical_status", e.target.value)}>
              {PHYSICAL_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className={`${inputClass} sm:col-span-2`} placeholder="Notes" value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>

          {/* Products */}
          <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Products ({products.length})</h2>
          <div className="space-y-2">
            {products.map((it, i) => (
              <div key={i} className="grid items-center gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_5rem_1fr_2rem]">
                <input className={inputClass} placeholder="SKU" value={it.sku ?? ""} onChange={(e) => setItem(i, "sku", e.target.value)} />
                <input className={inputClass} placeholder="Product" value={it.product ?? ""} onChange={(e) => setItem(i, "product", e.target.value)} />
                <input className={inputClass} type="number" placeholder="Qty" value={it.qty ?? 1} onChange={(e) => setItem(i, "qty", e.target.value ? Number(e.target.value) : 1)} />
                <select className={inputClass} value={it.condition ?? ""} onChange={(e) => setItem(i, "condition", e.target.value || null)}>
                  <option value="">Condition…</option>
                  {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <button type="button" title="Remove product" disabled={products.length <= 1} onClick={() => removeItem(i)}
                  className="rounded-md border border-slate-200 px-2 py-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:border-slate-700">×</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addItem} disabled={products.length >= MAX_ITEMS} className={`${btnSecondary} mt-2 disabled:opacity-50`}>
            + Add product{products.length >= MAX_ITEMS ? " (max 10)" : ""}
          </button>

          {/* Serial number */}
          <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Serial number</h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className={`${inputClass} sm:max-w-xs`}
              placeholder="Serial number"
              value={serialNumber}
              disabled={serialSkipped}
              onChange={(e) => setSerialNumber(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={serialSkipped}
                onChange={(e) => { setSerialSkipped(e.target.checked); if (e.target.checked) setSerialNumber(""); }}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Box / device not received — skip
            </label>
          </div>

          {/* Photos */}
          <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Photos ({totalImages}/{MAX_IMAGES})
          </h2>
          <div className="flex flex-wrap gap-2">
            {uploadedImageUrls.map((url, i) => (
              <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="Return photo" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeUploadedImage(i)}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white text-xs opacity-0 transition-opacity group-hover:opacity-100"
                >×</button>
              </div>
            ))}
            {pendingImages.map((img, i) => (
              <div key={img.previewUrl} className="group relative h-20 w-20 overflow-hidden rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt="Pending upload" className="h-full w-full object-cover opacity-80" />
                <div className="absolute inset-x-0 bottom-0 bg-indigo-600/70 py-0.5 text-center text-[9px] font-medium text-white">queued</div>
                <button
                  type="button"
                  onClick={() => removePendingImage(i)}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white text-xs opacity-0 transition-opacity group-hover:opacity-100"
                >×</button>
              </div>
            ))}
            {totalImages < MAX_IMAGES ? (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 dark:border-slate-700"
              >
                <span className="text-2xl leading-none font-light">+</span>
                <span className="text-[10px]">Add photo</span>
              </button>
            ) : null}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={handleImageSelect}
          />

          {/* Documentation */}
          <h2 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Documentation (Maricel)</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select className={inputClass} value={draft.doc_status ?? "pending"} onChange={(e) => set("doc_status", e.target.value)}>
              {DOC_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className={inputClass} type="number" placeholder="Claim / credit amount" value={draft.claim_amount ?? ""} onChange={(e) => set("claim_amount", e.target.value ? Number(e.target.value) : null)} />
            <input className={inputClass} placeholder="Credit note no" value={draft.credit_note_no ?? ""} onChange={(e) => set("credit_note_no", e.target.value)} />
            <input className={inputClass} placeholder="SRT no" value={draft.srt_number ?? ""} onChange={(e) => set("srt_number", e.target.value)} />
            <input className={inputClass} placeholder="PRT no" value={draft.prt_number ?? ""} onChange={(e) => set("prt_number", e.target.value)} />
            <input className={inputClass} placeholder="Dispute ID" value={draft.dispute_id ?? ""} onChange={(e) => set("dispute_id", e.target.value)} />
            <input className={inputClass} placeholder="Case ID" value={draft.case_id ?? ""} onChange={(e) => set("case_id", e.target.value)} />
            <input className={inputClass} placeholder="Doc remarks" value={draft.doc_remarks ?? ""} onChange={(e) => set("doc_remarks", e.target.value)} />
          </div>

          {err ? <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}

          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={btnSecondary} onClick={() => { pendingImages.forEach((img) => URL.revokeObjectURL(img.previewUrl)); setDraft(null); }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input className={`${inputClass} sm:col-span-2`} placeholder="Search RMA / order / SKU / product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={docPending} onChange={(e) => setDocPending(e.target.checked)} className="h-4 w-4" />
          Docs pending only
        </label>
      </div>

      <CustomizableTable<ReturnRow>
        viewKey="logistics_returns_view"
        rows={rows}
        loading={loading}
        emptyText="No returns logged yet."
        defaultHidden={["order", "condition"]}
        columns={[
          { id: "channel", label: "Channel", cell: (r) => rLabel(CHANNELS, r.channel) },
          { id: "rma", label: "Return ID", cell: (r) => r.return_ref ?? "—" },
          { id: "order", label: "Order #", cell: (r) => r.order_ref ?? "—" },
          {
            id: "sku",
            label: "SKU",
            cell: (r) => {
              const n = itemCount(r);
              return (
                <span>
                  {r.sku ?? "—"}
                  {n > 1 ? <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600">+{n - 1}</span> : null}
                </span>
              );
            },
          },
          { id: "product", label: "Product", cell: (r) => (itemCount(r) > 1 ? `${r.product ?? "—"} +${itemCount(r) - 1} more` : r.product ?? "—") },
          { id: "qty", label: "Qty", className: "tabular-nums", cell: (r) => r.qty ?? 1 },
          { id: "received", label: "Return date", cell: (r) => r.received_date ?? "—" },
          {
            id: "serial",
            label: "Serial #",
            cell: (r) =>
              r.serial_number
                ? <span className="font-mono text-xs">{r.serial_number}</span>
                : r.serial_number_skipped
                  ? <span className="italic text-slate-400 text-xs">skipped</span>
                  : <span className="text-slate-300">—</span>,
          },
          {
            id: "photos",
            label: "Photos",
            cell: (r) => {
              const urls = r.image_urls ?? [];
              if (!urls.length) return <span className="text-slate-300">—</span>;
              return (
                <div className="flex items-center gap-1">
                  {urls.slice(0, 3).map((url) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={url} src={url} alt="" className="h-8 w-8 rounded object-cover" />
                  ))}
                  {urls.length > 3 ? <span className="text-xs text-slate-500">+{urls.length - 3}</span> : null}
                </div>
              );
            },
          },
          { id: "condition", label: "Condition", cell: (r) => rLabel(CONDITIONS, r.condition) },
          { id: "physical", label: "Physical", cell: (r) => rLabel(PHYSICAL_STATUS, r.physical_status) },
          { id: "docs", label: "Docs", cell: (r) => <DocBadge value={r.doc_status} /> },
          {
            id: "logged",
            label: "Logged by",
            cell: (r) => (
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-medium">{r.logged_by_name ?? "—"}</span>
                <span className="text-[11px] text-slate-400">
                  {r.created_at
                    ? new Date(r.created_at).toLocaleDateString("en-AE", { day: "numeric", month: "short", year: "2-digit" })
                    : "—"}
                </span>
              </div>
            ),
          },
          {
            id: "actions",
            label: "Actions",
            cell: (r) => (
              <div className="flex items-center gap-2 whitespace-nowrap">
                {r.channel === "noon" ? (
                  <>
                    <a href="/logistics/noon?tab=returns" className="text-xs font-medium text-sky-600 hover:underline">↗ Returns</a>
                    {r.order_ref ? (
                      <a
                        href={`/logistics/noon?tab=orders&order=${encodeURIComponent(r.order_ref)}`}
                        className="text-xs font-medium text-sky-600 hover:underline"
                      >↗ Order</a>
                    ) : null}
                  </>
                ) : null}
                <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => openDraft(r)}>Edit</button>
                <button type="button" className="text-xs text-slate-500 hover:underline"
                  onClick={() => { setAuditReturnId(r.id); setAuditReturnRef(r.return_ref ?? null); }}>History</button>
                <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => remove(r.id)}>Delete</button>
              </div>
            ),
          },
        ]}
      />
    </LogisticsShell>
  );
}
