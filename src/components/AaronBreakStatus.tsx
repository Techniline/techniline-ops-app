"use client";

import { useEffect, useState } from "react";
import { fetchCurrentBreak, type UserBreak } from "@/lib/breaks";
import { isManager } from "@/lib/permissions";
import { useAuth } from "@/app/providers/AuthProvider";

/** Manager-only banner showing Aaron's live break status. */
export function AaronBreakStatus() {
  const { profile } = useAuth();
  const [activeBreak, setActiveBreak] = useState<UserBreak | null | undefined>(undefined);
  const [secs, setSecs] = useState(0);

  const canView = profile && isManager(profile);

  useEffect(() => {
    if (!canView) return;
    void fetchCurrentBreak().then(setActiveBreak);
    const id = setInterval(() => void fetchCurrentBreak().then(setActiveBreak), 30_000);
    return () => clearInterval(id);
  }, [canView]);

  useEffect(() => {
    if (!activeBreak) { setSecs(0); return; }
    const tick = () => {
      const rem = Math.max(0, Math.floor((new Date(activeBreak.expected_end_at).getTime() - Date.now()) / 1000));
      setSecs(rem);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeBreak]);

  if (!canView || activeBreak === undefined || !activeBreak) return null;

  const m = Math.floor(secs / 60), s = secs % 60;
  const label = activeBreak.type === "lunch" ? "Lunch break" : "Short break";
  const emoji = activeBreak.type === "lunch" ? "🍽️" : "☕";

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
      <span>{emoji}</span>
      <span className="font-medium text-amber-800 dark:text-amber-300">Aaron is on {label}</span>
      <span className="text-amber-600 dark:text-amber-400">·</span>
      <span className="text-amber-600 dark:text-amber-400 tabular-nums">
        Returns in {m}:{String(s).padStart(2, "0")} (auto-resume)
      </span>
    </div>
  );
}
