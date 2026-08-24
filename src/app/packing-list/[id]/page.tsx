"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";

import { supabase } from "@/lib/supabaseClient";
import {
  COMPANY_INFO,
  aedToWords,
  type PackingCompany,
  type PackingListItemRow,
  type PackingListRow,
} from "@/lib/packing/types";

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

function fmt2(n: number) {
  return n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt5(n: number | null | undefined) {
  if (n == null) return "—";
  return Number(n).toFixed(5).replace(/\.?0+$/, "");
}

/** Reusable letterhead header — logo + address bar */
function LetterHead({ company }: { company: typeof COMPANY_INFO[PackingCompany] }) {
  return (
    <div className="mb-0 border-b border-slate-300 pb-2 dark:border-slate-600">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={company.logo} alt={company.name} className="mb-1 h-14 w-auto object-contain print:h-12" />
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{company.addressBar}</p>
    </div>
  );
}

export default function PackingListView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [list, setList] = useState<PackingListRow | null>(null);
  const [items, setItems] = useState<PackingListItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getToken().then((token) => {
      fetch(`/api/packing/lists/${id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((json) => {
          if (!json.ok) throw new Error(json.error ?? "Not found");
          setList(json.list);
          setItems(json.items ?? []);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    });
  }, [id]);

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading…</div>;
  if (error || !list) return <div className="p-6 text-sm text-red-600">{error ?? "Not found."}</div>;

  const company = COMPANY_INFO[list.company as PackingCompany];
  const mode = list.mode;
  const isInvoice = mode === "invoice";

  const totCBM = items.reduce((s, i) => s + (i.tot_cbm ?? 0), 0);
  const totWeight = items.reduce((s, i) => s + (i.total_weight_kg ?? 0), 0);
  const totCtns = items.reduce((s, i) => s + (i.no_of_ctns ?? 0), 0);
  const shippingLabel = (list as { shipping_label?: string | null }).shipping_label ?? null;

  const assignedBoxNos = [...new Set(items.map((i) => i.box_no).filter((b): b is number => (b ?? 0) > 0))].sort((a, b) => a - b);
  function boxLabel(boxNo: number) {
    const lbl = shippingLabel?.trim().toUpperCase() ?? "";
    return lbl ? `${lbl}-${String(boxNo).padStart(2, "0")}` : `Box ${boxNo}`;
  }

  // Rowspan info for No. of Ctns — consecutive runs of same box_no
  type RenderItem = PackingListItemRow & { _rowspan: number; _showCtn: boolean };
  const renderItems: RenderItem[] = [];
  let ri = 0;
  while (ri < items.length) {
    const item = items[ri];
    const boxNo = item.box_no ?? 0;
    if (boxNo > 0) {
      let j = ri;
      while (j < items.length && (items[j].box_no ?? 0) === boxNo) j++;
      const span = j - ri;
      for (let k = ri; k < j; k++) {
        renderItems.push({ ...items[k], _rowspan: k === ri ? span : 0, _showCtn: k === ri });
      }
      ri = j;
    } else {
      renderItems.push({ ...item, _rowspan: 1, _showCtn: true });
      ri++;
    }
  }

  const subtotal = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const grandTotal = subtotal + vat;
  const countries = [...new Set(items.map((i) => i.country_of_origin).filter(Boolean))].join(", ");

  const listDateFmt = list.list_date
    ? new Date(list.list_date).toLocaleDateString("en-AE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  // Table cell classes
  const th = "border border-slate-400 px-2 py-1.5 text-center text-[11px] font-semibold bg-slate-50 dark:bg-slate-800 dark:border-slate-600";
  const td = "border border-slate-300 px-2 py-1.5 text-[11px] dark:border-slate-700";

  return (
    <>
      {/* Screen toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3 print:hidden dark:border-slate-700 dark:bg-slate-900">
        <Link href="/packing-list" className="text-sm text-slate-500 hover:text-slate-700">← All Lists</Link>
        <div className="flex-1" />
        <Link href={`/packing-list/new?edit=${id}`}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700">
          Edit
        </Link>
        <button type="button" onClick={() => window.print()}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Print / Export PDF
        </button>
      </div>

      {/* ── PAGE 1 ── */}
      <div className="mx-auto max-w-5xl bg-white p-8 print:p-0 print:max-w-none dark:bg-slate-900" id="print-page-1">

        {/* Letterhead */}
        <LetterHead company={company} />

        {/* Document title */}
        <div className="mt-4 mb-3">
          <h1 className="text-lg font-extrabold tracking-[0.2em] text-slate-800 dark:text-slate-100 underline underline-offset-4">
            P A C K I N G&nbsp; L I S T{isInvoice ? " / Tax Invoice" : ""}
          </h1>
        </div>

        {/* Shipper + Consignee */}
        <div className="mb-4 grid grid-cols-2 gap-8 text-sm">
          <div className="space-y-0.5">
            <p className="font-bold text-slate-600 dark:text-slate-400">Shipper:</p>
            <p className="font-bold text-slate-800 dark:text-slate-100">{company.name}</p>
            {company.address.map((line, i) => (
              <p key={i} className="text-slate-600 dark:text-slate-400">{line}</p>
            ))}
            <p className="text-slate-600 dark:text-slate-400">Tel #: {company.tel}, Fax #: {company.fax}</p>
          </div>
          <div className="space-y-0.5 text-right">
            <p className="font-bold text-slate-600 dark:text-slate-400">Consignee:</p>
            <p className="font-bold text-slate-800 dark:text-slate-100">{list.consignee_name}</p>
            {list.consignee_address?.split("\n").map((line, i) => (
              <p key={i} className="text-slate-600 dark:text-slate-400">{line}</p>
            ))}
            {list.list_date && <p className="mt-1 text-slate-600 dark:text-slate-400">Date &nbsp; {listDateFmt}</p>}
            {list.invoice_no && <p className="text-slate-600 dark:text-slate-400">Invoice No. &nbsp; {list.invoice_no}</p>}
            {shippingLabel && <p className="text-slate-600 dark:text-slate-400">Shipping Label &nbsp; <span className="font-semibold">{shippingLabel.toUpperCase()}</span></p>}
          </div>
        </div>

        {/* Main table */}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} w-8`}>SL</th>
              <th className={`${th} text-left`}>Brand</th>
              <th className={`${th} text-left`}>Model No</th>
              <th className={`${th} text-left`}>Description</th>
              <th className={th}>Country Of Origin</th>
              <th className={th}>HS CODE</th>
              <th className={th}>Qty</th>
              {isInvoice
                ? <th className={th}>Amount (AED)</th>
                : <th className={th}>No. of Ctns</th>
              }
              <th className={th}>Tot. CBM</th>
              <th className={th}>Total Weight Kgs</th>
            </tr>
          </thead>
          <tbody>
            {renderItems.map((item) => (
              <tr key={item.id}>
                <td className={`${td} text-center`}>{item.sl_no}</td>
                <td className={td}>{item.brand}</td>
                <td className={`${td} font-mono`}>{item.model_no}</td>
                <td className={td}>{item.description}</td>
                <td className={`${td} text-center`}>{item.country_of_origin}</td>
                <td className={`${td} text-center font-mono`}>{item.hs_code}</td>
                <td className={`${td} text-center`}>{item.qty}</td>
                {isInvoice
                  ? <td className={`${td} text-right`}>{item.amount != null ? fmt2(item.amount) : "—"}</td>
                  : item._showCtn
                    ? <td className={`${td} text-center align-middle`} rowSpan={item._rowspan > 1 ? item._rowspan : undefined}>
                        {(item.box_no ?? 0) > 0 && (
                          <div className="text-[9px] font-semibold text-slate-500 leading-tight">{boxLabel(item.box_no!)}</div>
                        )}
                        <div className="font-bold">{item.no_of_ctns ?? "—"}</div>
                      </td>
                    : null
                }
                <td className={`${td} text-center tabular-nums`}>{fmt5(item.tot_cbm)}</td>
                <td className={`${td} text-center tabular-nums`}>{item.total_weight_kg?.toFixed(2) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className={`${td} text-right font-bold`}>Total:-</td>
              <td className={`${td} text-center font-bold tabular-nums`}>{items.reduce((s, i) => s + i.qty, 0)}</td>
              {isInvoice
                ? <td className={`${td} text-right font-bold tabular-nums`}>{fmt2(subtotal)}</td>
                : <td className={`${td} text-center font-bold tabular-nums`}>{totCtns}</td>
              }
              <td className={`${td} text-center font-bold tabular-nums`}>{fmt5(totCBM)}</td>
              <td className={`${td} text-center font-bold tabular-nums`}>{totWeight.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        {/* VAT block (invoice mode) */}
        {isInvoice && (
          <div className="mt-4 space-y-1 text-sm">
            <p className="italic text-slate-600 dark:text-slate-400">{aedToWords(grandTotal)}</p>
            <div className="flex justify-end">
              <table className="text-sm">
                <tbody>
                  <tr><td className="pr-8 text-slate-500">Subtotal</td><td className="text-right tabular-nums font-medium">AED {fmt2(subtotal)}</td></tr>
                  <tr><td className="pr-8 text-slate-500">VAT 5%</td><td className="text-right tabular-nums">AED {fmt2(vat)}</td></tr>
                  <tr className="border-t border-slate-300 font-semibold dark:border-slate-600">
                    <td className="pr-8 pt-1">Total</td><td className="pt-1 text-right tabular-nums">AED {fmt2(grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer summary */}
        <div className="mt-4 text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
          <p><strong>Weight (KG):-</strong> {totWeight.toFixed(2)}</p>
          <p><strong>Total Cartons:-</strong> {totCtns}</p>
          {shippingLabel && assignedBoxNos.length > 0 && (
            <p><strong>Shipping Label:-</strong> {shippingLabel.toUpperCase()} — {assignedBoxNos.map((n) => boxLabel(n)).join(", ")}</p>
          )}
          {countries && <p><strong>Country of Origin:-</strong> {countries}</p>}
        </div>

        {/* Signature row */}
        <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
          <div className="border-t-2 border-slate-400 pt-2 dark:border-slate-500">
            <p className="text-slate-500">Stamp &amp; Signature (Customer)</p>
          </div>
          <div className="border-t-2 border-slate-400 pt-2 text-right dark:border-slate-500">
            <p className="font-bold tracking-wide text-slate-700 uppercase dark:text-slate-200">{company.name.toUpperCase()}</p>
          </div>
        </div>

        {/* Screen-only Box Summary */}
        {assignedBoxNos.length > 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 overflow-hidden print:hidden dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">📦 Box Summary</h3>
              {shippingLabel && <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Label: {shippingLabel.toUpperCase()}</span>}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {assignedBoxNos.map((boxNo) => {
                const boxItems = items.filter((i) => (i.box_no ?? 0) === boxNo);
                const boxCtns = boxItems.reduce((s, i) => s + (i.no_of_ctns ?? 0), 0);
                const boxCBM = boxItems.reduce((s, i) => s + (i.tot_cbm ?? 0), 0);
                const boxWeight = boxItems.reduce((s, i) => s + (i.total_weight_kg ?? 0), 0);
                return (
                  <div key={boxNo} className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-white dark:bg-slate-900">
                    <span className="min-w-[90px] text-sm font-bold text-slate-700 dark:text-slate-200">{boxLabel(boxNo)}</span>
                    <span className="text-xs text-slate-500">{boxItems.length} item{boxItems.length !== 1 ? "s" : ""}</span>
                    {boxCtns > 0 && <span className="text-xs font-semibold text-slate-600">{boxCtns} CTN{boxCtns !== 1 ? "s" : ""}</span>}
                    {boxCBM > 0 && <span className="text-xs text-slate-500">CBM: {fmt5(boxCBM)}</span>}
                    <span className="text-xs text-slate-500">{boxWeight.toFixed(2)} kg</span>
                    <div className="flex-1 min-w-0 text-xs text-slate-400 truncate">
                      {boxItems.map((i) => `${i.model_no} ×${i.qty}`).join(" · ")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── PAGE 2 — Box Breakdown (printed only when boxes exist) ── */}
      {assignedBoxNos.length > 0 && (
        <div className="mx-auto max-w-5xl bg-white px-8 pb-8 print:p-0 print:max-w-none print:mt-0 mt-8 border-t-4 border-dashed border-slate-300 pt-8 print:border-0 dark:bg-slate-900" id="print-page-2">

          {/* Letterhead repeated */}
          <LetterHead company={company} />

          <div className="mt-4 mb-4 flex items-baseline gap-4">
            <h2 className="text-base font-extrabold tracking-[0.15em] text-slate-800 uppercase underline underline-offset-4 dark:text-slate-100">
              Box Breakdown
            </h2>
            {shippingLabel && (
              <span className="text-sm font-semibold text-slate-500">— Shipping Label: <strong>{shippingLabel.toUpperCase()}</strong></span>
            )}
          </div>

          <div className="space-y-5">
            {assignedBoxNos.map((boxNo) => {
              const boxItems = items.filter((i) => (i.box_no ?? 0) === boxNo);
              const boxCtns = boxItems.reduce((s, i) => s + (i.no_of_ctns ?? 0), 0);
              const boxCBM  = boxItems.reduce((s, i) => s + (i.tot_cbm ?? 0), 0);
              const boxWeight = boxItems.reduce((s, i) => s + (i.total_weight_kg ?? 0), 0);
              return (
                <div key={boxNo}>
                  {/* Box header row */}
                  <div className="flex items-center gap-4 border border-slate-400 bg-slate-100 px-3 py-1.5 dark:bg-slate-800 dark:border-slate-600">
                    <span className="font-extrabold text-sm text-slate-800 dark:text-slate-100">{boxLabel(boxNo)}</span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">{boxCtns} carton{boxCtns !== 1 ? "s" : ""}</span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">CBM: {fmt5(boxCBM)}</span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">Weight: {boxWeight.toFixed(2)} kg</span>
                  </div>
                  {/* Items in this box */}
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={`${th} w-8`}>#</th>
                        <th className={`${th} text-left`}>Brand</th>
                        <th className={`${th} text-left`}>Model No</th>
                        <th className={`${th} text-left`}>Description</th>
                        <th className={th}>Qty</th>
                        <th className={th}>Tot. CBM</th>
                        <th className={th}>Weight Kgs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boxItems.map((item, i) => (
                        <tr key={item.id}>
                          <td className={`${td} text-center`}>{i + 1}</td>
                          <td className={td}>{item.brand}</td>
                          <td className={`${td} font-mono`}>{item.model_no}</td>
                          <td className={td}>{item.description}</td>
                          <td className={`${td} text-center tabular-nums`}>{item.qty}</td>
                          <td className={`${td} text-center tabular-nums`}>{fmt5(item.tot_cbm)}</td>
                          <td className={`${td} text-center tabular-nums`}>{item.total_weight_kg?.toFixed(2) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          {/* Page 2 footer */}
          <div className="mt-6 flex justify-between text-xs text-slate-500 border-t border-slate-300 pt-3">
            <span><strong>Total Boxes:</strong> {assignedBoxNos.length}</span>
            <span><strong>Total Cartons:</strong> {totCtns}</span>
            <span><strong>Total CBM:</strong> {fmt5(totCBM)}</span>
            <span><strong>Total Weight:</strong> {totWeight.toFixed(2)} kg</span>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm 14mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 11px; }
          .print\\:hidden { display: none !important; }
          #print-page-2 { page-break-before: always; }
        }
      `}</style>
    </>
  );
}
