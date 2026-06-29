"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Logo } from "@/components/icons";
import { btnPrimary, inputClass, surface } from "@/components/ui";
import { supabase } from "@/lib/supabaseClient";

/**
 * Password reset landing. Supabase's reset email links here with a recovery
 * token; supabase-js (detectSessionInUrl) exchanges it for a short-lived
 * recovery session. The user sets a new password → updateUser({ password }) →
 * it's saved in Supabase Auth. Then they sign in normally.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false); // recovery session detected
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let settled = false;
    // The recovery token arrives in the URL; supabase emits PASSWORD_RECOVERY
    // once it establishes the session.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
        settled = true;
        setReady(true);
      }
    });
    // Fallback: if a session already exists shortly after load, allow the reset.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) { settled = true; setReady(true); }
    });
    const t = setTimeout(() => { if (!settled) setLinkError(true); }, 4000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setSubmitting(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updErr) { setError(updErr.message); return; }
    setDone(true);
    await supabase.auth.signOut().catch(() => {});
    setTimeout(() => router.replace("/login"), 2500);
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-3" width={40} height={40} />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Set a new password</h1>
        </div>

        <div className={`${surface} p-6`}>
          {done ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              ✓ Password updated. Redirecting you to sign in…
            </p>
          ) : linkError && !ready ? (
            <div className="space-y-3">
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                This reset link is invalid or has expired. Request a new one from the sign-in page.
              </p>
              <button type="button" onClick={() => router.replace("/login")} className={btnPrimary}>Back to sign in</button>
            </div>
          ) : !ready ? (
            <p className="text-sm text-slate-500">Verifying your reset link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pw" className="text-sm font-medium text-slate-700 dark:text-slate-300">New password</label>
                <input id="pw" type="password" autoComplete="new-password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pw2" className="text-sm font-medium text-slate-700 dark:text-slate-300">Confirm new password</label>
                <input id="pw2" type="password" autoComplete="new-password" required placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
              </div>
              {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p> : null}
              <button type="submit" disabled={submitting} className={btnPrimary}>{submitting ? "Saving…" : "Update password"}</button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">© Techniline · Operations Portal</p>
      </div>
    </div>
  );
}
