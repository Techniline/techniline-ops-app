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
  const subtotal = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const grandTotal = subtotal + vat;
  const countries = [...new Set(items.map((i) => i.country_of_origin).filter(Boolean))].join(", ");

  const listDateFmt = list.list_date
    ? new Date(list.list_date).toLocaleDateString("en-AE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  return (
    <>
      {/* Screen-only toolbar */}
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

      {/* Print-optimised packing list */}
      <div className="mx-auto max-w-5xl p-6 print:p-0 print:max-w-none">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none dark:border-slate-700 dark:bg-slate-900">

          {/* Title */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-[0.25em] text-slate-800 dark:text-slate-100">
              P &nbsp;A &nbsp;C &nbsp;K &nbsp;I &nbsp;N &nbsp;G &nbsp; L &nbsp;I &nbsp;S &nbsp;T
              {isInvoice ? " / Tax Invoice" : ""}
            </h1>
          </div>

          {/* Shipper + Consignee */}
          <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="font-semibold text-slate-500">Shipper:</p>
              <p className="font-bold text-slate-800 dark:text-slate-100">{company.name}</p>
              {company.address.map((line, i) => (
                <p key={i} className="text-slate-600 dark:text-slate-400">{line}</p>
              ))}
              <p className="text-slate-600 dark:text-slate-400">Tel #: {company.tel}, Fax #: {company.fax}</p>
            </div>
            <div>
              <p className="font-semibold text-slate-500">Consignee:</p>
              <p className="font-bold text-slate-800 dark:text-slate-100">{list.consignee_name}</p>
              {list.consignee_address?.split("\n").map((line, i) => (
                <p key={i} className="text-slate-600 dark:text-slate-400">{line}</p>
              ))}
              {list.list_date && <p className="mt-2 text-slate-600 dark:text-slate-400">Date &nbsp;&nbsp;{listDateFmt}</p>}
              {list.invoice_no && <p className="text-slate-600 dark:text-slate-400">Invoice No. &nbsp;&nbsp;{list.invoice_no}</p>}
            </div>
          </div>

          {/* Main table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border border-slate-300 bg-slate-50 text-xs font-semibold dark:border-slate-600 dark:bg-slate-800">
                  <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">SL</th>
                  <th className="border border-slate-300 px-2 py-2 text-left dark:border-slate-600">Brand</th>
                  <th className="border border-slate-300 px-2 py-2 text-left dark:border-slate-600">Model No</th>
                  <th className="border border-slate-300 px-2 py-2 text-left dark:border-slate-600">Description</th>
                  <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">Country Of Origin</th>
                  <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">HS CODE</th>
                  <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">Qty</th>
                  {isInvoice
                    ? <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">Amount</th>
                    : <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">No. of Ctns</th>
                  }
                  <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">Tot. CBM</th>
                  <th className="border border-slate-300 px-2 py-2 dark:border-slate-600">Total Weight Kgs</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border border-slate-200 dark:border-slate-700">
                    <td className="border border-slate-200 px-2 py-1.5 text-center text-xs dark:border-slate-700">{item.sl_no}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-xs dark:border-slate-700">{item.brand}</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-mono text-xs dark:border-slate-700">{item.model_no}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-xs dark:border-slate-700">{item.description}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center text-xs dark:border-slate-700">{item.country_of_origin}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center font-mono text-xs dark:border-slate-700">{item.hs_code}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center text-xs dark:border-slate-700">{item.qty}</td>
                    {isInvoice
                      ? <td className="border border-slate-200 px-2 py-1.5 text-right text-xs dark:border-slate-700">{item.amount != null ? fmt2(item.amount) : "—"}</td>
                      : <td className="border border-slate-200 px-2 py-1.5 text-center text-xs dark:border-slate-700">{item.no_of_ctns ?? "—"}</td>
                    }
                    <td className="border border-slate-200 px-2 py-1.5 text-center text-xs dark:border-slate-700">{fmt5(item.tot_cbm)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-center text-xs dark:border-slate-700">{item.total_weight_kg?.toFixed(2) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border border-slate-300 bg-slate-50 font-semibold text-xs dark:border-slate-600 dark:bg-slate-800">
                  <td colSpan={6} className="border border-slate-300 px-2 py-2 text-right dark:border-slate-600">Total:—</td>
                  <td className="border border-slate-300 px-2 py-2 text-center dark:border-slate-600">{items.reduce((s, i) => s + i.qty, 0)}</td>
                  {isInvoice
                    ? <td className="border border-slate-300 px-2 py-2 text-right dark:border-slate-600">{fmt2(subtotal)}</td>
                    : <td className="border border-slate-300 px-2 py-2 text-center dark:border-slate-600">{totCtns}</td>
                  }
                  <td className="border border-slate-300 px-2 py-2 text-center dark:border-slate-600">{fmt5(totCBM)}</td>
                  <td className="border border-slate-300 px-2 py-2 text-center dark:border-slate-600">{totWeight.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* VAT block (invoice mode only) */}
          {isInvoice && (
            <div className="mt-4 space-y-1 text-sm">
              <p className="italic text-slate-600 dark:text-slate-400">{aedToWords(grandTotal)}</p>
              <div className="flex justify-end">
                <table className="text-sm">
                  <tbody>
                    <tr>
                      <td className="pr-8 text-slate-500">Subtotal</td>
                      <td className="text-right tabular-nums font-medium">AED {fmt2(subtotal)}</td>
                    </tr>
                    <tr>
                      <td className="pr-8 text-slate-500">VAT 5%</td>
                      <td className="text-right tabular-nums">AED {fmt2(vat)}</td>
                    </tr>
                    <tr className="border-t border-slate-300 font-semibold dark:border-slate-600">
                      <td className="pr-8 pt-1">Total</td>
                      <td className="pt-1 text-right tabular-nums">AED {fmt2(grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Footer info */}
          <div className="mt-6 space-y-1 text-xs text-slate-500">
            <p>Weight (KG):— {totWeight.toFixed(2)}</p>
            <p>Total Cartons:— {totCtns}</p>
            {countries && <p>Country of Origin:— {countries}</p>}
          </div>

          {/* Signature block */}
          <div className="mt-10 grid grid-cols-2 gap-6 text-sm">
            <div className="border-t border-slate-300 pt-3 dark:border-slate-600">
              <p className="text-slate-500">Stamp &amp; Signature (Customer)</p>
            </div>
            <div className="border-t border-slate-300 pt-3 text-right dark:border-slate-600">
              <p className="font-semibold text-slate-700 uppercase tracking-wide dark:text-slate-200">
                {company.name.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </>
  );
}
