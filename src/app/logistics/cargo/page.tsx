"use client";

import { useCallback, useEffect, useState } from "react";

import { CustomizableTable } from "@/components/logistics/CustomizableTable";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import { CARGO_STATUS, labelFor } from "@/lib/logistics/constants";
import { deleteCargo, fetchCargo, saveCargo, type CargoRow } from "@/lib/logistics/manual";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

type Draft = Partial<CargoRow>;
const EMPTY: Draft = { status: "new" };

export default function CargoDeliveriesPage() {
  const [rows, setRows] = useState<CargoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchCargo());
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
      await saveCargo(draft);
      setDraft(null);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this cargo delivery?")) return;
    setBusy(true);
    try {
      await deleteCargo(id);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof CargoRow, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  return (
    <LogisticsShell
      title="Cargo Deliveries"
      subtitle="Manual cargo / freight tracking."
      page="cargo"
      actions={
        <button type="button" className={btnPrimary} onClick={() => setDraft({ ...EMPTY })}>
          + New cargo
        </button>
      }
    >
      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {draft ? (
        <div className={`${surface} mb-4 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {draft.id ? "Edit cargo" : "New cargo delivery"}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input className={inputClass} placeholder="Consignee name" value={draft.consignee_name ?? ""} onChange={(e) => set("consignee_name", e.target.value)} />
            <input className={inputClass} placeholder="Reference no" value={draft.reference_no ?? ""} onChange={(e) => set("reference_no", e.target.value)} />
            <input className={inputClass} placeholder="Contact person" value={draft.contact_person ?? ""} onChange={(e) => set("contact_person", e.target.value)} />
            <input className={inputClass} placeholder="Phone" value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <input className={inputClass} placeholder="Destination" value={draft.destination ?? ""} onChange={(e) => set("destination", e.target.value)} />
            <input className={inputClass} placeholder="Cargo company" value={draft.cargo_company ?? ""} onChange={(e) => set("cargo_company", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2 lg:col-span-3`} placeholder="Delivery address" value={draft.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2`} placeholder="Items summary" value={draft.items_summary ?? ""} onChange={(e) => set("items_summary", e.target.value)} />
            <input className={inputClass} type="number" placeholder="Cartons" value={draft.cartons ?? ""} onChange={(e) => set("cartons", e.target.value ? Number(e.target.value) : null)} />
            <input className={inputClass} type="number" placeholder="Weight (kg)" value={draft.weight_kg ?? ""} onChange={(e) => set("weight_kg", e.target.value ? Number(e.target.value) : null)} />
            <input className={inputClass} placeholder="Dimensions" value={draft.dimensions ?? ""} onChange={(e) => set("dimensions", e.target.value)} />
            <input className={inputClass} placeholder="AWB number" value={draft.awb_number ?? ""} onChange={(e) => set("awb_number", e.target.value)} />
            <input className={inputClass} type="date" value={draft.dispatch_date ?? ""} onChange={(e) => set("dispatch_date", e.target.value || null)} />
            <select className={inputClass} value={draft.status ?? "new"} onChange={(e) => set("status", e.target.value)}>
              {CARGO_STATUS.map((s) => (
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

      <CustomizableTable<CargoRow>
        viewKey="logistics_cargo_view"
        rows={rows}
        loading={loading}
        emptyText="No cargo deliveries yet."
        columns={[
          { id: "consignee", label: "Consignee", cell: (r) => r.consignee_name ?? "—" },
          { id: "ref", label: "Ref", cell: (r) => r.reference_no ?? "—" },
          { id: "destination", label: "Destination", cell: (r) => r.destination ?? "—" },
          { id: "cartons", label: "Cartons", className: "tabular-nums", cell: (r) => r.cartons ?? "—" },
          { id: "weight", label: "Weight", className: "tabular-nums", cell: (r) => (r.weight_kg != null ? `${r.weight_kg} kg` : "—") },
          { id: "awb", label: "AWB", cell: (r) => r.awb_number ?? "—" },
          { id: "company", label: "Company", cell: (r) => r.cargo_company ?? "—" },
          { id: "status", label: "Status", cell: (r) => labelFor(CARGO_STATUS, r.status) },
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
