"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { canViewSellerOrders, isManager } from "@/lib/permissions";
import { supabase } from "@/lib/supabaseClient";
import { fetchWazzupStats } from "@/lib/wazzup";

/**
 * App-wide WhatsApp/Wazzup alerter. Mounted in the shared shell so the toast +
 * spoken voice + tab badge fire on ANY page while the app is open — not just the
 * dashboard. Only runs for managers and Aaron. The dashboard card is display-only;
 * this component owns all the alerting so there's a single source (no double pop).
 *
 * Note: when the app/browser is fully closed nothing here can run — that would
 * need Web Push (a service worker + an OS notification), which is a separate build.
 */
export function WazzupAlerts() {
  const { profile } = useAuth();
  const enabled = !!profile && (isManager(profile) || canViewSellerOrders(profile));

  const [toast, setToast] = useState<string | null>(null);
  const prevNewestAt = useRef<string | null>(null);
  const baseTitle = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    let alive = true;

    const tick = async () => {
      const r = await fetchWazzupStats();
      if (!alive) return;

      // Live browser-tab badge with the pending count (visible on any tab).
      document.title = r.pendingChats > 0 ? `(${r.pendingChats}) ${baseTitle.current}` : baseTitle.current;

      const ni = r.newestInbound;
      if (ni?.at) {
        // Alert only on a brand-new, still-unanswered inbound (skip the first
        // load so we don't shout about chats that were already waiting).
        if (prevNewestAt.current != null && ni.at > prevNewestAt.current && !ni.answered) {
          const name = ni.name;
          setToast(name ? `${name} · reply within 15 min` : "Reply within 15 min");
          window.setTimeout(() => setToast(null), 9000);
          if (localStorage.getItem("wz_muted") !== "1") {
            try {
              const u = new SpeechSynthesisUtterance(name ? `New chat waiting from ${name}, please reply` : "New chat waiting, please reply");
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(u);
            } catch { /* speech not available */ }
          }
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try { new Notification("New chat waiting", { body: name ? `${name} · reply within 15 min` : "Reply within 15 minutes", tag: "wazzup-pending" }); } catch { /* ignore */ }
          }
        }
        prevNewestAt.current = ni.at;
      }
    };

    void tick();
    const id = setInterval(() => void tick(), 15_000);
    const ch = supabase
      .channel("wazzup_alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wazzup_messages" }, () => void tick())
      .subscribe();

    return () => {
      alive = false;
      clearInterval(id);
      void supabase.removeChannel(ch);
      document.title = baseTitle.current;
    };
  }, [enabled]);

  if (!toast) return null;
  return (
    <div className="fixed right-4 top-4 z-[60] flex max-w-sm items-center gap-3 rounded-lg border border-rose-300 bg-white px-4 py-3 shadow-lg dark:border-rose-900 dark:bg-slate-900" style={{ borderLeftWidth: 3, borderLeftColor: "#e11d48" }}>
      <span aria-hidden="true" className="text-xl">🔔</span>
      <div className="text-sm">
        <p className="font-medium text-slate-900 dark:text-slate-100">New chat waiting</p>
        <p className="text-xs text-slate-500">{toast}</p>
      </div>
    </div>
  );
}
