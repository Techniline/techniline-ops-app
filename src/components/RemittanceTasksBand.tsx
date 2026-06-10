"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Modal } from "@/components/Modal";
import { btnPrimary, btnSecondary, inputClass } from "@/components/ui";
import { formatAED } from "@/lib/format";
import {
  CHARGE_TYPES,
  DISPUTE_STATUSES,
  addDeduction,
  chargeTypeLabel,
  closeDeduction,
  deleteDeduction,
  fetchDeductions,
  fetchRemittanceRefs,
  recoveryPct,
  reopenDeduction,
  rowToDraft,
  saveDeduction,
  validateClosure,
  type ChargeType,
  type DeductionDraft,
  type RemittanceDeduction,
} from "@/lib/remittanceDeductions";
import type { UserProfile } from "@/lib/types";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

const EMPTY: DeductionDraft = {
  charge_type: null, return_id: "", po_number: "", tle_invoice_number: "", srt_number: "",
  prt_number: "", dispute_id: "", amazon_case_id: "", return_missing: false,
  claim_amount_aed: "", approved_amount_aed: "", recovery_date: "", dispute_status: "", remark: "",
};

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
        {label}{required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function DeductionForm({
  row, profile, onDone,
}: { row: RemittanceDeduction; profile: UserProfile; onDone: () => void }) {
  const [d, setD] = useState<DeductionDraft>(rowToDraft(row));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof DeductionDraft>(k: K, v: DeductionDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  const ct = d.charge_type;
  const isReturn = ct === "vendor_return" || ct === "return_dispute";
  const missing = validateClosure(d);
  const rec = recoveryPct(Number(d.claim_amount_aed) || null, Number(d.approved_amount_aed) || null);
  const small = `${inputClass} py-1.5 text-sm`;

  async function act(close: boolean): Promise<void> {
    setErr(null);
    setBusy(true);
    try {
      if (close) await closeDeduction(row.id, d, profile.id);
      else await saveDeduction(row.id, d);
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Charge Type" required>
          <select className={small} value={ct ?? ""} onChange={(e) => set("charge_type", (e.target.value || null) as ChargeType | null)}>
            <option value="">— select —</option>
            {CHARGE_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>

        {isReturn ? (
          <>
            <Field label="Return not found?">
              <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={d.return_missing} onChange={(e) => set("return_missing", e.target.checked)} />
                Open Amazon case instead
              </label>
            </Field>
            {d.return_missing ? (
              <Field label="Amazon Case ID" required><input className={small} value={d.amazon_case_id} onChange={(e) => set("amazon_case_id", e.target.value)} /></Field>
            ) : (
              <Field label="Return ID" required><input className={small} value={d.return_id} onChange={(e) => set("return_id", e.target.value)} /></Field>
            )}
            <Field label="PO Number" required><input className={small} value={d.po_number} onChange={(e) => set("po_number", e.target.value)} /></Field>
            <Field label="TLE Invoice Number" required><input className={small} value={d.tle_invoice_number} onChange={(e) => set("tle_invoice_number", e.target.value)} /></Field>
          </>
        ) : null}

        {ct === "return_dispute" ? (
          <>
            <Field label="Dispute ID" required><input className={small} value={d.dispute_id} onChange={(e) => set("dispute_id", e.target.value)} /></Field>
            <Field label="Claim Amount AED" required><input type="number" step="0.01" className={small} value={d.claim_amount_aed} onChange={(e) => set("claim_amount_aed", e.target.value)} /></Field>
            <Field label="Dispute Status">
              <select className={small} value={d.dispute_status} onChange={(e) => set("dispute_status", e.target.value)}>
                <option value="">—</option>
                {DISPUTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Approved Amount AED"><input type="number" step="0.01" className={small} value={d.approved_amount_aed} onChange={(e) => set("approved_amount_aed", e.target.value)} /></Field>
            <Field label="Recovery Date"><input type="date" className={small} value={d.recovery_date} onChange={(e) => set("recovery_date", e.target.value)} /></Field>
            <div className="flex items-end pb-1 text-sm">
              <span className="rounded-md bg-emerald-100 px-2 py-1 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                Recovery: {rec == null ? "—" : `${rec}%`}
              </span>
            </div>
          </>
        ) : null}

        {ct === "shortage_claim" ? (
          <>
            <Field label="SRT Number"><input className={small} value={d.srt_number} onChange={(e) => set("srt_number", e.target.value)} /></Field>
            <Field label="Dispute ID"><input className={small} value={d.dispute_id} onChange={(e) => set("dispute_id", e.target.value)} /></Field>
            <Field label="Amazon Case ID"><input className={small} value={d.amazon_case_id} onChange={(e) => set("amazon_case_id", e.target.value)} /></Field>
          </>
        ) : null}

        {ct === "price_claim" ? (
          <Field label="PRT Number" required><input className={small} value={d.prt_number} onChange={(e) => set("prt_number", e.target.value)} /></Field>
        ) : null}

        {ct === "vendor_return" ? (
          <>
            <Field label="SRT Number (optional)"><input className={small} value={d.srt_number} onChange={(e) => set("srt_number", e.target.value)} /></Field>
            <Field label="PRT Number (optional)"><input className={small} value={d.prt_number} onChange={(e) => set("prt_number", e.target.value)} /></Field>
          </>
        ) : null}
      </div>

      <Field label="Remark" required>
        <textarea className={`${small} min-h-[56px]`} value={d.remark} onChange={(e) => set("remark", e.target.value)} placeholder="Explain this deduction for accounts" />
      </Field>

      {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
      {missing.length > 0 ? (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">Needed to close: {missing.join(", ")}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => act(false)} disabled={busy} className={btnSecondary}>Save draft</button>
        <button type="button" onClick={() => act(true)} disabled={busy || missing.length > 0} className={btnPrimary}>
          {busy ? "…" : "Close deduction"}
        </button>
      </div>
    </div>
  );
}

export function RemittanceTasksBand({ profile }: { profile: UserProfile }) {
  const [rows, setRows] = useState<RemittanceDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [expandedList, setExpandedList] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [refs, setRefs] = useState<{ ref: string; deductions: number | null; date: string | null }[]>([]);
  const [newRef, setNewRef] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await fetchDeductions({ includeClosed }));
    setLoading(false);
  }, [includeClosed]);
  useEffect(() => { void load(); }, [load]);

  async function openAdd(): Promise<void> {
    setRefs(await fetchRemittanceRefs());
    setNewRef("");
    setNewAmount("");
    setShowAdd(true);
  }
  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    if (newRef.trim() === "") return setErr("Enter the payment / remittance ref.");
    setAdding(true);
    try {
      await addDeduction(newRef.trim(), newAmount.trim() === "" ? null : Number(newAmount), profile.id);
      setShowAdd(false);
      await load();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setAdding(false);
    }
  }
  async function remove(id: string): Promise<void> {
    try { await deleteDeduction(id); await load(); } catch (e) { setErr(errMsg(e)); }
  }
  async function reopen(id: string): Promise<void> {
    try { await reopenDeduction(id); await load(); } catch (e) { setErr(errMsg(e)); }
  }

  const open = rows.filter((r) => r.status === "open");
  const totalNeg = open.reduce((s, r) => s + Math.abs(r.amount_aed ?? 0), 0);
  const oldest = open[0]?.created_at ? Math.floor((Date.now() - new Date(open[0].created_at).getTime()) / 86_400_000) : 0;

  function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
    return (
      <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-rose-100 bg-gradient-to-br from-white to-rose-50/50 p-4 text-center shadow-sm ring-1 ring-inset ring-white/60 dark:border-rose-900/50 dark:from-slate-900 dark:to-rose-950/20">
        <span className="absolute inset-y-0 left-0 w-1 bg-rose-400/80 dark:bg-rose-700" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700/90 dark:text-rose-400/90">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
      </div>
    );
  }

  return (
    <section className="mt-8 rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50/80 via-white to-white p-5 shadow-sm dark:border-rose-900/60 dark:from-rose-950/30 dark:via-slate-900 dark:to-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-rose-800 dark:text-rose-300">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.2)]" />
          REMITTANCE — NEGATIVE PAYMENTS TO EXPLAIN
        </h2>
        <button type="button" onClick={openAdd} className={btnPrimary}>+ Add deduction</button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Every negative line on a payment must be categorised with mandatory evidence before it closes — so accounts knows what each deduction is for.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Open Deductions" value={String(open.length)} tone="text-rose-700 dark:text-rose-400" />
        <Card label="Total Negative (open)" value={formatAED(totalNeg)} />
        <Card label="Oldest Waiting" value={oldest === 0 ? "today" : `${oldest}d`} tone="text-amber-700 dark:text-amber-400" />
      </div>

      {err ? <p className="mb-2 text-xs text-red-600">{err}</p> : null}
      <div className="mb-2 flex items-center gap-3 text-xs">
        <button type="button" onClick={() => setExpandedList((v) => !v)} className="font-semibold text-rose-700 hover:underline dark:text-rose-400">
          {expandedList ? "Hide list ▲" : `Show ${open.length} to action ▼`}
        </button>
        <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Show closed
        </label>
      </div>

      {expandedList ? (
        loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-rose-100 bg-white/70 p-6 text-center text-sm text-slate-500 dark:border-rose-900/50 dark:bg-slate-900/30">
            No deductions to explain. 🎉
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const closed = r.status === "closed";
              const isOpen = openRow === r.id;
              return (
                <li key={r.id} className={`rounded-2xl border p-3 ${closed ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/10" : "border-rose-100 bg-white/70 dark:border-rose-900/50 dark:bg-slate-900/30"}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Payment {r.remittance_ref}</span>
                    <span className="tabular-nums text-rose-700 dark:text-rose-400">{r.amount_aed != null ? formatAED(Math.abs(r.amount_aed)) : "—"}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{chargeTypeLabel(r.charge_type)}</span>
                    {closed ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Closed</span> : null}
                    <div className="ml-auto flex gap-1.5">
                      {closed ? (
                        <button type="button" onClick={() => reopen(r.id)} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">Reopen</button>
                      ) : (
                        <>
                          <button type="button" onClick={() => setOpenRow(isOpen ? null : r.id)} className="rounded-md border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-700 dark:border-rose-800 dark:text-rose-300">{isOpen ? "Close form" : "Categorise"}</button>
                          <button type="button" onClick={() => remove(r.id)} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-700">Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                  {r.remark ? <p className="mt-1 text-[11px] text-slate-400">{r.remark}</p> : null}
                  {isOpen && !closed ? <DeductionForm row={r} profile={profile} onDone={() => { setOpenRow(null); void load(); }} /> : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {showAdd ? (
        <Modal title="Add a negative deduction" onClose={() => setShowAdd(false)}>
          <form onSubmit={add}>
            <Field label="Payment / Remittance ref" required>
              <input className={inputClass} list="rem-refs" value={newRef} onChange={(e) => setNewRef(e.target.value)} placeholder="e.g. 364499709" autoFocus />
              <datalist id="rem-refs">
                {refs.map((r) => <option key={r.ref} value={r.ref}>{r.date ?? ""} · deductions {r.deductions != null ? formatAED(r.deductions) : "?"}</option>)}
              </datalist>
            </Field>
            <div className="mt-2">
              <Field label="Deduction amount AED (the minus value)">
                <input type="number" step="0.01" className={inputClass} value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="e.g. 1250.00" />
              </Field>
            </div>
            {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={adding} className={btnPrimary}>{adding ? "Adding…" : "Add"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
