"use client";

import { useCallback, useEffect, useState } from "react";

import { CustomizableTable } from "@/components/logistics/CustomizableTable";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import { RESELLER_STATUS } from "@/lib/logistics/constants";
import {
  deleteReseller,
  fetchResellers,
  saveReseller,
  setResellerStatus,
  type ResellerRow,
} from "@/lib/logistics/manual";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

const OPEN_RESELLER = new Set(["new", "preparing", "ready", "out_for_delivery", "issue"]);

/** Days a delivery is overdue against its scheduled date (0 if not overdue / no date). */
function overdueDays(row: ResellerRow): number {
  if (!row.scheduled_date || !OPEN_RESELLER.has(row.status)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(row.scheduled_date);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

type Draft = Partial<ResellerRow>;
const EMPTY: Draft = { status: "new" };

export default function ResellerDeliveriesPage() {
  const [rows, setRows] = useState<ResellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchResellers());
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      await saveReseller(draft);
      setDraft(null);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this reseller delivery?")) return;
    setBusy(true);
    try {
      await deleteReseller(id);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    setBusy(true);
    setErr(null);
    try {
      await setResellerStatus(id, status);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof ResellerRow, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  return (
    <LogisticsShell
      title="Reseller Deliveries"
      subtitle="Manual reseller delivery tracking."
      page="reseller"
      actions={
        <button type="button" className={btnPrimary} onClick={() => setDraft({ ...EMPTY })}>
          + New delivery
        </button>
      }
    >
      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {draft ? (
        <div className={`${surface} mb-4 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {draft.id ? "Edit delivery" : "New reseller delivery"}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input className={inputClass} placeholder="Reseller name" value={draft.reseller_name ?? ""} onChange={(e) => set("reseller_name", e.target.value)} />
            <input className={inputClass} placeholder="Reference no" value={draft.reference_no ?? ""} onChange={(e) => set("reference_no", e.target.value)} />
            <input className={inputClass} placeholder="Contact person" value={draft.contact_person ?? ""} onChange={(e) => set("contact_person", e.target.value)} />
            <input className={inputClass} placeholder="Phone" value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <input className={inputClass} placeholder="City" value={draft.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            <input className={inputClass} placeholder="Payment method" value={draft.payment_method ?? ""} onChange={(e) => set("payment_method", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2 lg:col-span-3`} placeholder="Delivery address" value={draft.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2`} placeholder="Items summary" value={draft.items_summary ?? ""} onChange={(e) => set("items_summary", e.target.value)} />
            <input className={inputClass} type="number" placeholder="Total value" value={draft.total_value ?? ""} onChange={(e) => set("total_value", e.target.value ? Number(e.target.value) : null)} />
            <input className={inputClass} placeholder="Courier" value={draft.courier ?? ""} onChange={(e) => set("courier", e.target.value)} />
            <input className={inputClass} placeholder="Tracking number" value={draft.tracking_number ?? ""} onChange={(e) => set("tracking_number", e.target.value)} />
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Scheduled delivery date
              <input className={inputClass} type="date" value={draft.scheduled_date ?? ""} onChange={(e) => set("scheduled_date", e.target.value || null)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Dispatch date
              <input className={inputClass} type="date" value={draft.dispatch_date ?? ""} onChange={(e) => set("dispatch_date", e.target.value || null)} />
            </label>
            <select className={inputClass} value={draft.status ?? "new"} onChange={(e) => set("status", e.target.value)}>
              {RESELLER_STATUS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <input className={`${inputClass} sm:col-span-2 lg:col-span-3`} placeholder="Notes" value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <CustomizableTable<ResellerRow>
        viewKey="logistics_reseller_view"
        rows={rows}
        loading={loading}
        emptyText="No reseller deliveries yet."
        rowClassName={(r) =>
          overdueDays(r) > 0 ? "bg-rose-50 dark:bg-rose-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
        }
        columns={[
          { id: "reseller", label: "Reseller", cell: (r) => r.reseller_name ?? "—" },
          { id: "ref", label: "Ref", cell: (r) => r.reference_no ?? "—" },
          { id: "city", label: "City", cell: (r) => r.city ?? "—" },
          { id: "items", label: "Items", cell: (r) => r.items_summary ?? "—" },
          { id: "value", label: "Value", className: "tabular-nums", cell: (r) => (r.total_value != null ? r.total_value.toFixed(2) : "—") },
          {
            id: "scheduled",
            label: "Scheduled",
            cell: (r) => {
              const od = overdueDays(r);
              return r.scheduled_date ? (
                <div className="flex flex-col">
                  <span>{r.scheduled_date}</span>
                  {od > 0 ? <span className="text-[11px] font-semibold text-rose-600">{od}d late</span> : null}
                </div>
              ) : (
                "—"
              );
            },
          },
          {
            id: "status",
            label: "Status",
            cell: (r) => (
              <select
                value={r.status}
                disabled={busy}
                onChange={(e) => changeStatus(r.id, e.target.value)}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                {RESELLER_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            ),
          },
          {
            id: "actions",
            label: "",
            cell: (r) => (
              <div className="flex gap-2">
                <button type="button" className="text-indigo-600 hover:underline" onClick={() => setDraft(r)}>
                  Edit
                </button>
                <button type="button" className="text-rose-600 hover:underline" onClick={() => remove(r.id)}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />
    </LogisticsShell>
  );
}
