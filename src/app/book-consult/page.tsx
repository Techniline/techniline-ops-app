"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type Step = "form" | "submitting" | "success" | "error";

export default function BookConsultPage() {
  const [step, setStep] = useState<Step>("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    preferred_slot: "",
    notes: "",
  });

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStep("submitting");
    try {
      const res = await fetch("/api/consults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          preferred_slot: form.preferred_slot || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Unknown error");
      setStep("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStep("error");
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition-colors";

  if (step === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Request received!</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            One of our sales consultants will call you within{" "}
            <strong className="text-slate-700">4 working hours</strong>
            {" "}(Mon–Fri 9:30–18:30, Sat 9:30–14:00).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Book a Sales Consult</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Fill in your details and we&apos;ll call you within 4 working hours.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          {step === "error" && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={set("name")}
                placeholder="Your name"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                required
                value={form.phone}
                onChange={set("phone")}
                placeholder="+971 50 000 0000"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Email <span className="text-slate-400 font-normal normal-case">(optional)</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                placeholder="you@example.com"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Preferred time <span className="text-slate-400 font-normal normal-case">(optional)</span>
              </label>
              <select value={form.preferred_slot} onChange={set("preferred_slot")} className={inputCls}>
                <option value="">No preference — call anytime</option>
                <option value="morning">Morning (9:30 – 12:00)</option>
                <option value="afternoon">Afternoon (12:00 – 15:00)</option>
                <option value="late_afternoon">Late afternoon (15:00 – 18:30)</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                What are you looking for? <span className="text-slate-400 font-normal normal-case">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={set("notes")}
                placeholder="e.g. soundbar, home theatre setup, budget range…"
                className={`${inputCls} resize-none`}
              />
            </div>

            <button
              type="submit"
              disabled={step === "submitting"}
              className="mt-1 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
            >
              {step === "submitting" ? "Sending…" : "Request a call"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Working hours: Mon–Fri 9:30–18:30 · Sat 9:30–14:00 · Sun closed
        </p>
      </div>
    </div>
  );
}
