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
  buildReconEmailHtml,
  chargeTypeLabel,
  closeDeduction,
  deleteDeduction,
  emailReconciliation,
  fetchDeductions,
  fetchOpenRemittancePayments,
  fetchRemittanceLines,
  markRemittanceReviewed,
  REMITTANCE_START,
  saveLineRemark,
  triggerReingest,
  recoveryPct,
  reopenDeduction,
  rowToDraft,
  saveDeduction,
  validateClosure,
  type ChargeType,
  type DeductionDraft,
  type RemittanceDeduction,
  type RemittanceLine,
  type RemittancePayment,
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

/** Auto-parsed invoice breakdown for a payment (read-only table, like the email). */
function PaymentBreakdown({ paymentRef }: { paymentRef: string }) {
  const [lines, setLines] = useState<RemittanceLine[] | null>(null);
  useEffect(() => {
    let active = true;
    fetchRemittanceLines(paymentRef).then((l) => { if (active) setLines(l); });
    return () => { active = false; };
  }, [paymentRef]);

  if (lines === null) return <p className="mt-2 text-[11px] text-slate-400">Loading breakdown…</p>;
  if (lines.length === 0) {
    return <p className="mt-2 text-[11px] text-slate-400">No line breakdown parsed for this payment yet (header-only email, or not re-ingested).</p>;
  }
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/50">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Invoice</th>
            <th className="px-2 py-1 text-left font-medium">Date</th>
            <th className="px-2 py-1 text-left font-medium">Description</th>
            <th className="px-2 py-1 text-right font-medium">Amount Paid</th>
            <th className="px-2 py-1 text-right font-medium">Remaining</th>
            <th className="px-2 py-1 text-left font-medium">Note / reason (for accounts)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const neg = (l.amount_paid_aed ?? 0) < 0;
            return (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1 font-medium text-slate-800 dark:text-slate-200">{l.invoice_number}{l.partial ? " *" : ""}</td>
                <td className="px-2 py-1 text-slate-500">{l.invoice_date ?? "—"}</td>
                <td className="px-2 py-1 text-slate-500">{l.description}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${neg ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-300"}`}>
                  {l.amount_paid_aed != null ? formatAED(l.amount_paid_aed) : "—"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-slate-500">{l.amount_remaining_aed != null ? formatAED(l.amount_remaining_aed) : "—"}</td>
                <td className="px-2 py-1">
                  <input
                    defaultValue={l.recon_remark ?? ""}
                    placeholder="e.g. distributor return…"
                    onBlur={(e) => { if ((e.target.value.trim() || "") !== (l.recon_remark ?? "")) void saveLineRemark(l.id, e.target.value); }}
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-2 py-1 text-[10px] text-slate-400">Add a note on any line (e.g. distributor return) — it’s saved automatically and included in the email to accounts. Negative (red) lines are deductions to categorise below. “*” = partially paid / previously deducted.</p>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-rose-100 bg-gradient-to-br from-white to-rose-50/50 p-4 text-center shadow-sm ring-1 ring-inset ring-white/60 dark:border-rose-900/50 dark:from-slate-900 dark:to-rose-950/20">
      <span className="absolute inset-y-0 left-0 w-1 bg-rose-400/80 dark:bg-rose-700" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700/90 dark:text-rose-400/90">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

export function RemittanceTasksBand({ profile }: { profile: UserProfile }) {
  const [payments, setPayments] = useState<RemittancePayment[]>([]);
  const [rows, setRows] = useState<RemittanceDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [openPayment, setOpenPayment] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [addFor, setAddFor] = useState<string | null>(null); // payment ref the add modal targets
  const [newAmount, setNewAmount] = useState("");
  const [adding, setAdding] = useState(false);

  const [emailFor, setEmailFor] = useState<RemittancePayment | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function syncEmails(): Promise<void> {
    setErr(null);
    setBanner(null);
    setSyncing(true);
    try {
      const msg = await triggerReingest();
      setBanner(msg);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSyncing(false);
    }
  }

  async function sendEmail(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!emailFor) return;
    setErr(null);
    setBanner(null);
    if (!emailTo.includes("@")) { setErr("Enter a valid recipient email."); return; }
    setSending(true);
    try {
      const lines = await fetchRemittanceLines(emailFor.ref);
      const html = buildReconEmailHtml(emailFor, lines, dedsByRef(emailFor.ref));
      await emailReconciliation({
        to: emailTo,
        cc: emailCc,
        subject: `Remittance reconciliation — Payment ${emailFor.ref}`,
        html,
      });
      setEmailFor(null);
      setEmailTo("");
      setEmailCc("");
      setBanner(`Reconciliation emailed for Payment ${emailFor.ref}.`);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setSending(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [pays, deds] = await Promise.all([
      fetchOpenRemittancePayments(),
      fetchDeductions({ includeClosed: true }),
    ]);
    setPayments(pays);
    setRows(deds);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dedsByRef = (ref: string) => rows.filter((r) => r.remittance_ref === ref);
  // Show recent payments OR any payment that has deductions to explain.
  const shownPayments = payments.filter(
    (p) => (p.receivedAt ?? "") >= REMITTANCE_START || dedsByRef(p.ref).length > 0
  );
  const shownRefs = new Set(shownPayments.map((p) => p.ref));
  const openDeds = rows.filter((r) => r.status === "open" && shownRefs.has(r.remittance_ref));
  const totalNeg = openDeds.reduce((s, r) => s + Math.abs(r.amount_aed ?? 0), 0);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!addFor) return;
    setErr(null);
    setAdding(true);
    try {
      await addDeduction(addFor, newAmount.trim() === "" ? null : Number(newAmount), profile.id);
      setNewAmount("");
      setAddFor(null);
      await load();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setAdding(false);
    }
  }
  async function reviewed(p: RemittancePayment): Promise<void> {
    setErr(null);
    try { await markRemittanceReviewed(p.ref); await load(); } catch (e) { setErr(errMsg(e)); }
  }
  async function remove(id: string): Promise<void> { try { await deleteDeduction(id); await load(); } catch (e) { setErr(errMsg(e)); } }
  async function reopen(id: string): Promise<void> { try { await reopenDeduction(id); await load(); } catch (e) { setErr(errMsg(e)); } }

  return (
    <section className="mt-8 rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50/80 via-white to-white p-5 shadow-sm dark:border-rose-900/60 dark:from-rose-950/30 dark:via-slate-900 dark:to-slate-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-rose-800 dark:text-rose-300">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.2)]" />
          REMITTANCE — PAYMENTS TO REVIEW
        </h2>
        <button type="button" onClick={syncEmails} disabled={syncing} className={btnSecondary}>
          {syncing ? "Syncing…" : "Sync remittance emails"}
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Each Amazon payment captured from email. Break it down line-wise; every negative needs a charge type + mandatory evidence before it closes, then mark the payment reviewed.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Payments to Review" value={String(shownPayments.length)} tone="text-rose-700 dark:text-rose-400" />
        <Card label="Open Deductions" value={String(openDeds.length)} />
        <Card label="Total Negative (open)" value={formatAED(totalNeg)} tone="text-amber-700 dark:text-amber-400" />
      </div>

      {banner ? <p className="mb-2 text-xs text-emerald-700 dark:text-emerald-400">{banner}</p> : null}
      {err ? <p className="mb-2 text-xs text-red-600">{err}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : shownPayments.length === 0 ? (
        <div className="rounded-2xl border border-rose-100 bg-white/70 p-6 text-center text-sm text-slate-500 dark:border-rose-900/50 dark:bg-slate-900/30">
          No remittance payments awaiting review. 🎉
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shownPayments.map((p) => {
            const deds = dedsByRef(p.ref);
            const open = deds.filter((d) => d.status === "open");
            const isOpen = openPayment === p.ref;
            return (
              <li key={p.id} className="rounded-2xl border border-rose-100 bg-white/70 p-3 dark:border-rose-900/50 dark:bg-slate-900/30">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button type="button" onClick={() => setOpenPayment(isOpen ? null : p.ref)} className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <span className="text-rose-400">{isOpen ? "▾" : "▸"}</span>
                    Payment {p.ref}
                  </button>
                  <span className="text-[11px] text-slate-400">{p.receivedAt ? p.receivedAt.slice(0, 10) : ""}{p.amount != null ? ` · net ${formatAED(p.amount)}` : ""}</span>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">{open.length} open · {deds.length - open.length} done</span>
                  <div className="ml-auto flex gap-1.5">
                    <button type="button" onClick={() => { setAddFor(p.ref); setNewAmount(""); }} className="rounded-md border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-700 dark:border-rose-800 dark:text-rose-300">+ Deduction</button>
                    <button
                      type="button"
                      onClick={() => { setEmailFor(p); setEmailTo(""); setEmailCc(""); }}
                      disabled={open.length > 0}
                      title={open.length > 0 ? "Categorise & close every deduction first" : "Email the reconciliation to accounts"}
                      className="rounded-md border border-indigo-300 px-2 py-1 text-[11px] font-medium text-indigo-700 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300"
                    >
                      Email to accounts
                    </button>
                    <button type="button" onClick={() => reviewed(p)} disabled={open.length > 0} title={open.length > 0 ? "Close all deductions first" : "Mark this payment reviewed"} className="rounded-md border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-700 disabled:opacity-40 dark:border-emerald-800 dark:text-emerald-300">Mark reviewed</button>
                  </div>
                </div>

                {isOpen ? (
                  <>
                  <PaymentBreakdown paymentRef={p.ref} />
                  {deds.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-400">No deductions to categorise. If the breakdown above shows red (negative) lines that aren’t listed below, re-ingest the email; otherwise “Mark reviewed”.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {deds.map((r) => {
                        const closed = r.status === "closed";
                        const rowOpen = openRow === r.id;
                        return (
                          <li key={r.id} className={`rounded-xl border p-2 ${closed ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/10" : "border-rose-100 bg-rose-50/30 dark:border-rose-900/50 dark:bg-slate-900/40"}`}>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="tabular-nums font-medium text-rose-700 dark:text-rose-400">{r.amount_aed != null ? formatAED(Math.abs(r.amount_aed)) : "—"}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{chargeTypeLabel(r.charge_type)}</span>
                              {closed ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Closed</span> : null}
                              <div className="ml-auto flex gap-1.5">
                                {closed ? (
                                  <button type="button" onClick={() => reopen(r.id)} className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">Reopen</button>
                                ) : (
                                  <>
                                    <button type="button" onClick={() => setOpenRow(rowOpen ? null : r.id)} className="rounded-md border border-rose-300 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:border-rose-800 dark:text-rose-300">{rowOpen ? "Close form" : "Categorise"}</button>
                                    <button type="button" onClick={() => remove(r.id)} className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-slate-700">Delete</button>
                                  </>
                                )}
                              </div>
                            </div>
                            {r.remark ? <p className="mt-1 text-[11px] text-slate-400">{r.remark}</p> : null}
                            {rowOpen && !closed ? <DeductionForm row={r} profile={profile} onDone={() => { setOpenRow(null); void load(); }} /> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {addFor ? (
        <Modal title={`Add deduction — Payment ${addFor}`} onClose={() => setAddFor(null)}>
          <form onSubmit={add}>
            <Field label="Deduction amount AED (the minus value)" required>
              <input type="number" step="0.01" className={inputClass} value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="e.g. 1250.00" autoFocus />
            </Field>
            <p className="mt-1 text-[11px] text-slate-500">You’ll categorise it (charge type + evidence) on the next step.</p>
            {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAddFor(null)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={adding} className={btnPrimary}>{adding ? "Adding…" : "Add"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {emailFor ? (
        <Modal title={`Email reconciliation — Payment ${emailFor.ref}`} onClose={() => setEmailFor(null)} wide>
          <form onSubmit={sendEmail}>
            <Field label="To (accounts)" required>
              <input className={inputClass} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="accounts@techniline.org" autoFocus />
            </Field>
            <div className="mt-2">
              <Field label="CC (optional, comma-separated)">
                <input className={inputClass} value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="manager@techniline.org, …" />
              </Field>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              The email includes the full invoice breakdown for this payment, with each line’s amount and the
              <b> reason / how-to-settle</b> from operations (charge type, return/dispute/case IDs, and your notes) so
              accounts can reconcile it.
            </p>
            {err ? <p className="mt-2 text-xs text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEmailFor(null)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={sending} className={btnPrimary}>{sending ? "Sending…" : "Send to accounts"}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
