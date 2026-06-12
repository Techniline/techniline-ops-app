"use client";

import { useCallback, useEffect, useState } from "react";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { btnPrimary, btnSecondary, inputClass, surface, tableWrap, tdCell, thCell } from "@/components/ui";
import { labelFor, PRT_STATUS, PRT_URGENCY, SOURCE_LOCATIONS } from "@/lib/logistics/constants";
import {
  buildPrtEmail,
  fetchPrts,
  savePrt,
  sendPrtEmail,
  setPrtStatus,
  type PrtRow,
} from "@/lib/logistics/manual";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

type Draft = Partial<PrtRow>;
const EMPTY: Draft = { status: "requested", urgency: "normal", qty: 1 };

export default function PrtRequestsPage() {
  const [rows, setRows] = useState<PrtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Email modal
  const [emailFor, setEmailFor] = useState<PrtRow | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchPrts());
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

  const set = (k: keyof PrtRow, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  async function save() {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      await savePrt(draft);
      setDraft(null);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    setBusy(true);
    try {
      await setPrtStatus(id, status);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function openEmail(p: PrtRow) {
    const { subject: s, body: b } = buildPrtEmail(p);
    setSubject(s);
    setBody(b);
    setTo("");
    setMsg(null);
    setEmailFor(p);
  }

  async function send() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await sendPrtEmail(to, subject, body);
      setMsg(`Email sent to ${to}.`);
      setEmailFor(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setMsg("Copied to clipboard.");
    } catch {
      setErr("Could not copy — select and copy manually.");
    }
  }

  return (
    <LogisticsShell
      title="Product Transfer Requests (PRT)"
      subtitle="Branch-to-branch stock transfer requests."
      actions={
        <button type="button" className={btnPrimary} onClick={() => setDraft({ ...EMPTY })}>
          + New PRT
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
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {draft.id ? "Edit PRT" : "New PRT request"}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input className={inputClass} placeholder="Order number" value={draft.order_number ?? ""} onChange={(e) => set("order_number", e.target.value)} />
            <input className={inputClass} placeholder="Customer" value={draft.customer_name ?? ""} onChange={(e) => set("customer_name", e.target.value)} />
            <input className={inputClass} placeholder="SKU" value={draft.sku ?? ""} onChange={(e) => set("sku", e.target.value)} />
            <input className={`${inputClass} sm:col-span-2`} placeholder="Product title" value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)} />
            <input className={inputClass} placeholder="Brand" value={draft.brand ?? ""} onChange={(e) => set("brand", e.target.value)} />
            <input className={inputClass} type="number" placeholder="Qty" value={draft.qty ?? 1} onChange={(e) => set("qty", e.target.value ? Number(e.target.value) : 1)} />
            <select className={inputClass} value={draft.from_location ?? ""} onChange={(e) => set("from_location", e.target.value)}>
              <option value="">From location…</option>
              {SOURCE_LOCATIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select className={inputClass} value={draft.to_location ?? ""} onChange={(e) => set("to_location", e.target.value)}>
              <option value="">To location…</option>
              {SOURCE_LOCATIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className={inputClass} type="date" value={draft.required_date ?? ""} onChange={(e) => set("required_date", e.target.value || null)} />
            <select className={inputClass} value={draft.urgency ?? "normal"} onChange={(e) => set("urgency", e.target.value)}>
              {PRT_URGENCY.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
            <select className={inputClass} value={draft.status ?? "requested"} onChange={(e) => set("status", e.target.value)}>
              {PRT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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

      {/* Email generator modal */}
      {emailFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`${surface} w-full max-w-2xl p-5`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              PRT email — {emailFor.sku ?? ""} / Order {emailFor.order_number ?? "—"}
            </h2>
            <input className={`${inputClass} mb-2`} placeholder="Recipient email (branch)" value={to} onChange={(e) => setTo(e.target.value)} />
            <input className={`${inputClass} mb-2`} value={subject} onChange={(e) => setSubject(e.target.value)} />
            <textarea className={`${inputClass} mb-3 h-64 font-mono text-xs`} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={busy || !to.includes("@")} onClick={send}>
                {busy ? "Sending…" : "Send email"}
              </button>
              <button type="button" className={btnSecondary} onClick={copyBody}>Copy</button>
              <button type="button" className={btnSecondary} onClick={() => setEmailFor(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={tableWrap}>
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className={thCell}>Order</th>
              <th className={thCell}>SKU</th>
              <th className={thCell}>Product</th>
              <th className={thCell}>Qty</th>
              <th className={thCell}>From → To</th>
              <th className={thCell}>Urgency</th>
              <th className={thCell}>Status</th>
              <th className={thCell}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className={tdCell} colSpan={8}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className={tdCell} colSpan={8}>No PRT requests yet.</td></tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={tdCell}>{p.order_number ?? "—"}</td>
                  <td className={tdCell}>{p.sku ?? "—"}</td>
                  <td className={tdCell}>{p.title ?? "—"}</td>
                  <td className={`${tdCell} tabular-nums`}>{p.qty ?? 1}</td>
                  <td className={tdCell}>
                    {labelFor(SOURCE_LOCATIONS, p.from_location)} → {labelFor(SOURCE_LOCATIONS, p.to_location)}
                  </td>
                  <td className={tdCell}>{labelFor(PRT_URGENCY, p.urgency)}</td>
                  <td className={tdCell}>
                    <select
                      value={p.status}
                      disabled={busy}
                      onChange={(e) => changeStatus(p.id, e.target.value)}
                      className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      {PRT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className={tdCell}>
                    <div className="flex gap-2">
                      <button type="button" className="text-indigo-600 hover:underline" onClick={() => openEmail(p)}>Email</button>
                      <button type="button" className="text-slate-600 hover:underline" onClick={() => setDraft(p)}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </LogisticsShell>
  );
}
