"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import { Logo } from "@/components/icons";
import { btnPrimary, inputClass, surface } from "@/components/ui";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  async function handleForgot() {
    setError(null);
    setResetMsg(null);
    if (!email) {
      setError("Enter your email above first, then click “Forgot password”.");
      return;
    }
    setResetting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setResetMsg(`If ${email} has an account, a password-reset link is on its way. Check your inbox.`);
  }

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    router.replace("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-3" width={40} height={40} />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Techniline Operations
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to access your workspace.
          </p>
        </div>

        <div className={`${surface} p-6`}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@techniline.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              >
                {error}
              </p>
            ) : null}
            {resetMsg ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {resetMsg}
              </p>
            ) : null}

            <button type="submit" disabled={submitting} className={btnPrimary}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={handleForgot}
              disabled={resetting}
              className="text-center text-xs text-slate-500 hover:text-indigo-600 hover:underline disabled:opacity-50 dark:text-slate-400"
            >
              {resetting ? "Sending reset link…" : "Forgot password?"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          © Techniline · Operations Portal
        </p>
      </div>
    </div>
  );
}
