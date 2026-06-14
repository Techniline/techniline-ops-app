"use client";

import { useState } from "react";

import { supabase } from "@/lib/supabaseClient";

/** Manager tool: verify the Amazon Seller SP-API credentials and probe which
 *  Seller APIs / reports the granted roles allow. */
export function SellerConnectionCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [probe, setProbe] = useState<{ label: string; status: number | string }[] | null>(null);

  async function authHeader() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token ?? ""}` };
  }

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/spapi/seller-ping", { headers: await authHeader() });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; configured?: boolean; detail?: string; error?: string };
      if (j.configured === false) setResult({ ok: false, text: "Not configured — Seller SP-API env vars aren't set / deployed yet." });
      else setResult({ ok: !!j.ok, text: j.ok ? `Connected ✓ — ${j.detail ?? ""}` : `Failed — ${j.error ?? j.detail ?? "unknown"}` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  async function discover() {
    setBusy(true);
    setProbe(null);
    try {
      const res = await fetch("/api/spapi/seller-ping?probe=1", { headers: await authHeader() });
      const j = (await res.json().catch(() => ({}))) as { results?: { label: string; status: number | string }[] };
      setProbe(j.results ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Seller SP-API connection</span>
      <button
        type="button"
        onClick={test}
        disabled={busy}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {busy ? "Testing…" : "Test connection"}
      </button>
      <button
        type="button"
        onClick={discover}
        disabled={busy}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {busy ? "…" : "Discover access"}
      </button>
      {result ? <span className={`text-sm ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.text}</span> : null}
      {probe ? (
        <ul className="basis-full text-xs text-slate-600 dark:text-slate-300">
          {probe.map((p) => (
            <li key={p.label}>
              <span className={p.status === 200 ? "text-emerald-700" : p.status === 403 ? "text-amber-600" : "text-rose-600"}>
                {String(p.status)}
              </span>{" "}
              · {p.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
