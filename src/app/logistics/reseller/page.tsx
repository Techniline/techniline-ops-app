"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CustomizableTable } from "@/components/logistics/CustomizableTable";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface } from "@/components/ui";
import { RESELLER_STATUS } from "@/lib/logistics/constants";
import {
  deleteReseller,
  fetchResellerSuggestions,
  fetchResellers,
  parseDocPdf,
  saveReseller,
  setResellerStatus,
  type ResellerRow,
  type ResellerSuggestions,
} from "@/lib/logistics/manual";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

const OPEN_RESELLER = new Set(["new", "preparing", "ready", "out_for_delivery", "issue"]);

function overdueDays(row: ResellerRow): number {
  if (!row.scheduled_date || !OPEN_RESELLER.has(row.status)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(row.scheduled_date);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

const fld = (label: string, value: string) =>
  `<tr><td style="padding:6px 10px;border:1px solid #ccc;background:#f3f4f6;font-weight:bold;width:160px">${label}</td><td style="padding:6px 10px;border:1px solid #ccc">${value || "—"}</td></tr>`;

/** Open a printable delivery note for one record. */
function printNote(r: ResellerRow) {
  const w = window.open("", "_blank", "width=820,height=920");
  if (!w) return;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:#111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #4f46e5;padding-bottom:10px">
      <div><div style="font-size:20px;font-weight:bold;color:#4f46e5">Techniline</div><div style="font-size:12px;color:#555">Reseller Delivery Note</div></div>
      <div style="text-align:right;font-size:12px;color:#555">DO: <strong>${r.do_number ?? "—"}</strong><br>Invoice: <strong>${r.invoice_number ?? "—"}</strong><br>Date: ${r.scheduled_date ?? r.dispatch_date ?? ""}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:14px">
      ${fld("Reseller / Customer", r.reseller_name ?? "")}
      ${fld("Contact person", r.contact_person ?? "")}
      ${fld("Phone", r.phone ?? "")}
      ${fld("City", r.city ?? "")}
      ${fld("Delivery address", r.delivery_address ?? "")}
      ${fld("Items", r.items_summary ?? "")}
      ${fld("Total value", r.total_value != null ? `AED ${r.total_value.toFixed(2)}` : "")}
      ${fld("Payment method", r.payment_method ?? "")}
      ${fld("Reference", r.reference_no ?? "")}
      ${fld("Driver", r.driver_name ?? "")}
      ${fld("Driver phone", r.driver_phone ?? "")}
      ${fld("Vehicle number", r.vehicle_number ?? "")}
      ${fld("Courier", r.courier ?? "")}
      ${fld("Tracking", r.tracking_number ?? "")}
      ${fld("Notes", r.notes ?? "")}
    </table>
    <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:13px">
      <div style="border-top:1px solid #999;padding-top:6px;width:45%">Delivered by (driver)</div>
      <div style="border-top:1px solid #999;padding-top:6px;width:45%">Received by (customer)</div>
    </div>
  </div>`;
  w.document.write(`<html><head><title>Delivery Note ${r.do_number ?? r.reseller_name ?? ""}</title></head><body>${html}<script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}

type Draft = Partial<ResellerRow>;
const EMPTY: Draft = { status: "new" };

export default function ResellerDeliveriesPage() {
  const [rows, setRows] = useState<ResellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sugg, setSugg] = useState<ResellerSuggestions>({ customers: [], drivers: [], vehicles: [] });

  // Recall filters
  const [search, setSearch] = useState("");
  const [fromD, setFromD] = useState("");
  const [toD, setToD] = useState("");

  const filters = useMemo(
    () => ({ search, from: fromD || undefined, to: toD ? `${toD}` : undefined }),
    [search, fromD, toD]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchResellers(filters));
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

  useEffect(() => {
    void fetchResellerSuggestions().then(setSugg).catch(() => {});
  }, []);

  const set = (k: keyof ResellerRow, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  // Autocomplete back-fill: typing a known customer/driver fills linked fields.
  function onCustomer(v: string) {
    setDraft((d) => {
      const next = { ...(d ?? {}), reseller_name: v };
      const m = sugg.customers.find((c) => c.name.toLowerCase() === v.trim().toLowerCase());
      if (m) {
        if (!next.contact_person) next.contact_person = m.contact_person ?? next.contact_person;
        if (!next.phone) next.phone = m.phone ?? next.phone;
        if (!next.city) next.city = m.city ?? next.city;
        if (!next.delivery_address) next.delivery_address = m.delivery_address ?? next.delivery_address;
      }
      return next;
    });
  }
  function onDriver(v: string) {
    setDraft((d) => {
      const next = { ...(d ?? {}), driver_name: v };
      const m = sugg.drivers.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
      if (m && !next.driver_phone) next.driver_phone = m.phone ?? next.driver_phone;
      return next;
    });
  }

  async function uploadInvoice(file: File) {
    setParsing(true);
    setErr(null);
    setMsg(null);
    try {
      const d = await parseDocPdf(file);
      setDraft((cur) => {
        const next = { ...(cur ?? { status: "new" }) };
        if (d.customerName && !next.reseller_name) next.reseller_name = d.customerName;
        if (d.invoiceNumber) next.invoice_number = d.invoiceNumber;
        if (d.doNumber) next.do_number = d.doNumber;
        if (d.poNumber && !next.reference_no) next.reference_no = d.poNumber;
        else if (d.invoiceNumber && !next.reference_no) next.reference_no = d.invoiceNumber;
        if (d.totalValue != null) next.total_value = d.totalValue;
        if (d.deliveryAddress && !next.delivery_address) next.delivery_address = d.deliveryAddress;
        if (d.itemsSummary && !next.items_summary) next.items_summary = d.itemsSummary;
        return next;
      });
      const what = d.docType === "delivery_note" ? "delivery note" : d.docType === "invoice" ? "invoice" : "document";
      if (d.engine === "basic") {
        setErr(
          `Read the ${what} but only document numbers could be captured — the AI extractor isn't available on the server (ANTHROPIC_API_KEY not set), so customer/value/items didn't fill. Fill the rest manually, or set the key to enable full auto-fill.`
        );
      } else {
        setMsg(`Captured from ${what} — review and complete the delivery details.`);
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      await saveReseller(draft);
      setDraft(null);
      await load();
      void fetchResellerSuggestions().then(setSugg).catch(() => {});
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
      {msg ? (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>
      ) : null}
      {err ? (
        <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {/* Shared suggestion lists */}
      <datalist id="rd-customers">{sugg.customers.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      <datalist id="rd-drivers">{sugg.drivers.map((d) => <option key={d.name} value={d.name} />)}</datalist>
      <datalist id="rd-vehicles">{sugg.vehicles.map((v) => <option key={v} value={v} />)}</datalist>

      {draft ? (
        <div className={`${surface} mb-4 p-4`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {draft.id ? "Edit delivery" : "New reseller delivery"}
            </h2>
            <label className={`${parsing ? "pointer-events-none opacity-60" : ""} cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800`}>
              {parsing ? "Reading…" : "📎 Upload invoice / DO"}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={parsing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadInvoice(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input list="rd-customers" className={inputClass} placeholder="Reseller / customer name" value={draft.reseller_name ?? ""} onChange={(e) => onCustomer(e.target.value)} />
            <input className={inputClass} placeholder="Invoice number" value={draft.invoice_number ?? ""} onChange={(e) => set("invoice_number", e.target.value)} />
            <input className={inputClass} placeholder="DO number" value={draft.do_number ?? ""} onChange={(e) => set("do_number", e.target.value)} />
            <input className={inputClass} placeholder="Contact person" value={draft.contact_person ?? ""} onChange={(e) => set("contact_person", e.target.value)} />
            <input className={inputClass} placeholder="Phone" value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <input className={inputClass} placeholder="City" value={draft.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2 lg:col-span-3`} placeholder="Delivery address" value={draft.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2`} placeholder="Items summary" value={draft.items_summary ?? ""} onChange={(e) => set("items_summary", e.target.value)} />
            <input className={inputClass} type="number" placeholder="Total value" value={draft.total_value ?? ""} onChange={(e) => set("total_value", e.target.value ? Number(e.target.value) : null)} />
            <input list="rd-drivers" className={inputClass} placeholder="Driver name" value={draft.driver_name ?? ""} onChange={(e) => onDriver(e.target.value)} />
            <input className={inputClass} placeholder="Driver phone" value={draft.driver_phone ?? ""} onChange={(e) => set("driver_phone", e.target.value)} />
            <input list="rd-vehicles" className={inputClass} placeholder="Vehicle number" value={draft.vehicle_number ?? ""} onChange={(e) => set("vehicle_number", e.target.value)} />
            <input className={inputClass} placeholder="Payment method" value={draft.payment_method ?? ""} onChange={(e) => set("payment_method", e.target.value)} />
            <input className={inputClass} placeholder="Courier (optional)" value={draft.courier ?? ""} onChange={(e) => set("courier", e.target.value)} />
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
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <input className={`${inputClass} sm:col-span-2 lg:col-span-3`} placeholder="Notes" value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Recall bar — search past records instead of a giant list */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          className={`${inputClass} col-span-2`}
          placeholder="Recall by customer / invoice / DO / reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input className={inputClass} type="date" value={fromD} onChange={(e) => setFromD(e.target.value)} title="From scheduled date" />
        <input className={inputClass} type="date" value={toD} onChange={(e) => setToD(e.target.value)} title="To scheduled date" />
      </div>
      <p className="mb-2 text-xs text-slate-400">
        {search || fromD || toD ? "Showing matches." : "Showing the 25 most recent — use the recall bar to find older records."}
      </p>

      <CustomizableTable<ResellerRow>
        viewKey="logistics_reseller_view"
        rows={rows}
        loading={loading}
        emptyText="No reseller deliveries found."
        rowClassName={(r) => (overdueDays(r) > 0 ? "bg-rose-50 dark:bg-rose-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/40")}
        columns={[
          { id: "reseller", label: "Customer", cell: (r) => r.reseller_name ?? "—" },
          { id: "invoice", label: "Invoice", cell: (r) => r.invoice_number ?? "—" },
          { id: "do", label: "DO", cell: (r) => r.do_number ?? "—" },
          { id: "city", label: "City", cell: (r) => r.city ?? "—" },
          { id: "value", label: "Value", className: "tabular-nums", cell: (r) => (r.total_value != null ? r.total_value.toFixed(2) : "—") },
          { id: "driver", label: "Driver", cell: (r) => r.driver_name ?? "—" },
          { id: "vehicle", label: "Vehicle", cell: (r) => r.vehicle_number ?? "—" },
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
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            ),
          },
          {
            id: "actions",
            label: "",
            cell: (r) => (
              <div className="flex gap-2">
                <button type="button" className="text-slate-600 hover:underline" onClick={() => printNote(r)}>Print</button>
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
