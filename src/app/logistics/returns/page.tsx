"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CustomizableTable } from "@/components/logistics/CustomizableTable";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import { SOURCE_LOCATIONS, labelFor } from "@/lib/logistics/constants";
import {
  CHANNELS,
  CONDITIONS,
  DOC_STATUS,
  PHYSICAL_STATUS,
  RETURN_REASONS,
  deleteReturn,
  fetchReturns,
  notifyReturnLogged,
  rLabel,
  saveReturn,
  type ReturnFilters,
  type ReturnRow,
} from "@/lib/logistics/marketplace";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

type Draft = Partial<ReturnRow>;
const EMPTY: Draft = { physical_status: "received", doc_status: "pending", qty: 1, location: "warehouse" };

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

export default function MarketplaceReturnsPage() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [channel, setChannel] = useState("");
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

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof ReturnRow, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  async function save() {
    if (!draft) return;
    if (!draft.channel) {
      setErr("Choose a channel.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const isNew = !draft.id;
      const saved = await saveReturn(draft);
      if (isNew) {
        const summary = `${rLabel(CHANNELS, saved.channel)} return ${saved.return_ref ?? ""} — ${saved.sku ?? saved.product ?? ""} ×${saved.qty ?? 1}`;
        void notifyReturnLogged(summary);
      }
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

  return (
    <LogisticsShell
      title="Marketplace Returns"
      subtitle="Warehouse-logged returns (Amazon Vendor / DF / Seller-Flex / Noon) + documentation."
      page="marketplace"
      wide
      actions={
        <button type="button" className={btnPrimary} onClick={() => setDraft({ ...EMPTY })}>
          + Log return
        </button>
      }
    >
      {msg ? (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>
      ) : null}
      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {draft ? (
        <div className={`${surface} mb-4 p-4`}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Warehouse / receipt (Kesh)</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select className={inputClass} value={draft.channel ?? ""} onChange={(e) => set("channel", e.target.value)}>
              <option value="">Channel…</option>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input className={inputClass} placeholder="Return / RMA ref" value={draft.return_ref ?? ""} onChange={(e) => set("return_ref", e.target.value)} />
            <input className={inputClass} placeholder="Order / PO" value={draft.order_ref ?? ""} onChange={(e) => set("order_ref", e.target.value)} />
            <input className={inputClass} placeholder="ASIN (Amazon)" value={draft.asin ?? ""} onChange={(e) => set("asin", e.target.value)} />
            <input className={inputClass} placeholder="SKU" value={draft.sku ?? ""} onChange={(e) => set("sku", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2`} placeholder="Product" value={draft.product ?? ""} onChange={(e) => set("product", e.target.value)} />
            <input className={inputClass} placeholder="Brand" value={draft.brand ?? ""} onChange={(e) => set("brand", e.target.value)} />
            <input className={inputClass} type="number" placeholder="Qty" value={draft.qty ?? 1} onChange={(e) => set("qty", e.target.value ? Number(e.target.value) : 1)} />
            <select className={inputClass} value={draft.reason ?? ""} onChange={(e) => set("reason", e.target.value)}>
              <option value="">Reason…</option>
              {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <input className={inputClass} placeholder="Carrier" value={draft.carrier ?? ""} onChange={(e) => set("carrier", e.target.value)} />
            <input className={inputClass} placeholder="Tracking number" value={draft.tracking_number ?? ""} onChange={(e) => set("tracking_number", e.target.value)} />
            <label className="flex flex-col gap-1 text-xs text-slate-500">Received date
              <input className={inputClass} type="date" value={draft.received_date ?? ""} onChange={(e) => set("received_date", e.target.value || null)} />
            </label>
            <select className={inputClass} value={draft.condition ?? ""} onChange={(e) => set("condition", e.target.value)}>
              <option value="">Condition…</option>
              {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select className={inputClass} value={draft.physical_status ?? "received"} onChange={(e) => set("physical_status", e.target.value)}>
              {PHYSICAL_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select className={inputClass} value={draft.location ?? "warehouse"} onChange={(e) => set("location", e.target.value)}>
              {SOURCE_LOCATIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className={`${inputClass} sm:col-span-2 lg:col-span-4`} placeholder="Notes" value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>

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
            <input className={`${inputClass} sm:col-span-2 lg:col-span-1`} placeholder="Doc remarks" value={draft.doc_remarks ?? ""} onChange={(e) => set("doc_remarks", e.target.value)} />
          </div>

          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={btnSecondary} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input className={`${inputClass} sm:col-span-2`} placeholder="Search RMA / order / SKU / ASIN / product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={docPending} onChange={(e) => setDocPending(e.target.checked)} className="h-4 w-4" />
          Docs pending only
        </label>
      </div>

      <CustomizableTable<ReturnRow>
        viewKey="logistics_returns_view"
        rows={rows}
        loading={loading}
        emptyText="No returns logged yet."
        defaultHidden={["order", "asin", "condition", "location"]}
        columns={[
          { id: "channel", label: "Channel", cell: (r) => rLabel(CHANNELS, r.channel) },
          { id: "rma", label: "RMA", cell: (r) => r.return_ref ?? "—" },
          { id: "order", label: "Order", cell: (r) => r.order_ref ?? "—" },
          { id: "asin", label: "ASIN", cell: (r) => r.asin ?? "—" },
          { id: "sku", label: "SKU", cell: (r) => r.sku ?? "—" },
          { id: "product", label: "Product", cell: (r) => r.product ?? "—" },
          { id: "qty", label: "Qty", className: "tabular-nums", cell: (r) => r.qty ?? 1 },
          { id: "received", label: "Received", cell: (r) => r.received_date ?? "—" },
          { id: "condition", label: "Condition", cell: (r) => rLabel(CONDITIONS, r.condition) },
          { id: "physical", label: "Physical", cell: (r) => rLabel(PHYSICAL_STATUS, r.physical_status) },
          { id: "location", label: "Location", cell: (r) => labelFor(SOURCE_LOCATIONS, r.location) },
          { id: "docs", label: "Docs", cell: (r) => <DocBadge value={r.doc_status} /> },
          {
            id: "actions",
            label: "Actions",
            cell: (r) => (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <button type="button" className="text-indigo-600 hover:underline" onClick={() => setDraft(r)}>Edit</button>
                <button type="button" className="text-rose-600 hover:underline" onClick={() => remove(r.id)}>Delete</button>
              </div>
            ),
          },
        ]}
      />
    </LogisticsShell>
  );
}
