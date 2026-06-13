"use client";

import { useCallback, useEffect, useState } from "react";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import {
  deleteMaster,
  fetchCustomers,
  fetchDrivers,
  fetchVehicles,
  saveCustomer,
  saveDriver,
  saveVehicle,
  type CustomerRow,
  type DriverRow,
  type VehicleRow,
} from "@/lib/logistics/manual";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

type Kind = "customers" | "drivers" | "vehicles";
const TABS: { key: Kind; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "drivers", label: "Drivers" },
  { key: "vehicles", label: "Vehicles" },
];

export default function MasterDataPage() {
  const [tab, setTab] = useState<Kind>("customers");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      if (tab === "customers") setCustomers(await fetchCustomers());
      else if (tab === "drivers") setDrivers(await fetchDrivers());
      else setVehicles(await fetchVehicles());
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  async function save() {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      if (tab === "customers") await saveCustomer(draft as Partial<CustomerRow>);
      else if (tab === "drivers") await saveDriver(draft as Partial<DriverRow>);
      else await saveVehicle(draft as Partial<VehicleRow>);
      setDraft(null);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this master record? Past deliveries keep their saved details.")) return;
    setBusy(true);
    try {
      await deleteMaster(tab, id);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const newLabel = tab === "customers" ? "+ New customer" : tab === "drivers" ? "+ New driver" : "+ New vehicle";

  return (
    <LogisticsShell
      title="Master Data"
      subtitle="Customers, drivers & vehicles — manager only. Auto-filled from deliveries; edit here."
      page="masters"
      wide
      actions={
        <button type="button" className={btnPrimary} onClick={() => setDraft({ active: true })}>
          {newLabel}
        </button>
      }
    >
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setDraft(null);
            }}
            className={tab === t.key ? btnPrimary : btnSecondary}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {draft ? (
        <div className={`${surface} mb-4 p-4`}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tab === "customers" ? (
              <>
                <input className={inputClass} placeholder="Customer name" value={(draft.name as string) ?? ""} onChange={(e) => set("name", e.target.value)} />
                <input className={inputClass} placeholder="Contact person" value={(draft.contact_person as string) ?? ""} onChange={(e) => set("contact_person", e.target.value)} />
                <input className={inputClass} placeholder="Phone" value={(draft.phone as string) ?? ""} onChange={(e) => set("phone", e.target.value)} />
                <input className={inputClass} placeholder="City" value={(draft.city as string) ?? ""} onChange={(e) => set("city", e.target.value)} />
                <input className={inputClass} placeholder="TRN / VAT" value={(draft.trn as string) ?? ""} onChange={(e) => set("trn", e.target.value)} />
                <input className={inputClass} placeholder="Payment terms" value={(draft.payment_terms as string) ?? ""} onChange={(e) => set("payment_terms", e.target.value)} />
                <input className={`${inputClass} sm:col-span-2 lg:col-span-3`} placeholder="Address" value={(draft.address as string) ?? ""} onChange={(e) => set("address", e.target.value)} />
              </>
            ) : tab === "drivers" ? (
              <>
                <input className={inputClass} placeholder="Driver name" value={(draft.name as string) ?? ""} onChange={(e) => set("name", e.target.value)} />
                <input className={inputClass} placeholder="Phone" value={(draft.phone as string) ?? ""} onChange={(e) => set("phone", e.target.value)} />
                <input className={inputClass} placeholder="License no" value={(draft.license_no as string) ?? ""} onChange={(e) => set("license_no", e.target.value)} />
                <label className="flex flex-col gap-1 text-xs text-slate-500">License expiry
                  <input className={inputClass} type="date" value={(draft.license_expiry as string) ?? ""} onChange={(e) => set("license_expiry", e.target.value || null)} />
                </label>
              </>
            ) : (
              <>
                <input className={inputClass} placeholder="Plate / vehicle number" value={(draft.plate as string) ?? ""} onChange={(e) => set("plate", e.target.value)} />
                <input className={inputClass} placeholder="Type (van, truck…)" value={(draft.vehicle_type as string) ?? ""} onChange={(e) => set("vehicle_type", e.target.value)} />
                <label className="flex flex-col gap-1 text-xs text-slate-500">Registration expiry
                  <input className={inputClass} type="date" value={(draft.reg_expiry as string) ?? ""} onChange={(e) => set("reg_expiry", e.target.value || null)} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500">Insurance expiry
                  <input className={inputClass} type="date" value={(draft.insurance_expiry as string) ?? ""} onChange={(e) => set("insurance_expiry", e.target.value || null)} />
                </label>
              </>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={(draft.active as boolean) ?? true} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4" />
              Active
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={btnSecondary} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div className={`${tableWrap} max-h-[65vh] overflow-auto`}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {tab === "customers" ? (
                <>
                  <th className={thCell}>Name</th><th className={thCell}>Contact</th><th className={thCell}>Phone</th>
                  <th className={thCell}>City</th><th className={thCell}>TRN</th><th className={thCell}>Terms</th>
                </>
              ) : tab === "drivers" ? (
                <>
                  <th className={thCell}>Name</th><th className={thCell}>Phone</th><th className={thCell}>License</th><th className={thCell}>Lic. expiry</th>
                </>
              ) : (
                <>
                  <th className={thCell}>Plate</th><th className={thCell}>Type</th><th className={thCell}>Reg. expiry</th><th className={thCell}>Ins. expiry</th>
                </>
              )}
              <th className={thCell}>Active</th>
              <th className={thCell}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className={tdCell} colSpan={8}>Loading…</td></tr>
            ) : tab === "customers" ? (
              customers.length === 0 ? <tr><td className={tdCell} colSpan={8}>No customers yet.</td></tr> :
              customers.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={tdCell}>{r.name}</td><td className={tdCell}>{r.contact_person ?? "—"}</td><td className={tdCell}>{r.phone ?? "—"}</td>
                  <td className={tdCell}>{r.city ?? "—"}</td><td className={tdCell}>{r.trn ?? "—"}</td><td className={tdCell}>{r.payment_terms ?? "—"}</td>
                  <td className={tdCell}>{r.active ? "Yes" : "No"}</td>
                  <td className={tdCell}><RowActions onEdit={() => setDraft(r)} onDelete={() => remove(r.id)} /></td>
                </tr>
              ))
            ) : tab === "drivers" ? (
              drivers.length === 0 ? <tr><td className={tdCell} colSpan={8}>No drivers yet.</td></tr> :
              drivers.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={tdCell}>{r.name}</td><td className={tdCell}>{r.phone ?? "—"}</td><td className={tdCell}>{r.license_no ?? "—"}</td>
                  <td className={tdCell}>{r.license_expiry ?? "—"}</td>
                  <td className={tdCell}>{r.active ? "Yes" : "No"}</td>
                  <td className={tdCell}><RowActions onEdit={() => setDraft(r)} onDelete={() => remove(r.id)} /></td>
                </tr>
              ))
            ) : (
              vehicles.length === 0 ? <tr><td className={tdCell} colSpan={8}>No vehicles yet.</td></tr> :
              vehicles.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={tdCell}>{r.plate}</td><td className={tdCell}>{r.vehicle_type ?? "—"}</td><td className={tdCell}>{r.reg_expiry ?? "—"}</td>
                  <td className={tdCell}>{r.insurance_expiry ?? "—"}</td>
                  <td className={tdCell}>{r.active ? "Yes" : "No"}</td>
                  <td className={tdCell}><RowActions onEdit={() => setDraft(r)} onDelete={() => remove(r.id)} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </LogisticsShell>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" className="text-indigo-600 hover:underline" onClick={onEdit}>Edit</button>
      <button type="button" className="text-rose-600 hover:underline" onClick={onDelete}>Delete</button>
    </div>
  );
}
