"use client";

import { useEffect, useRef, useState } from "react";

import { surface } from "@/components/ui";
import { supabase } from "@/lib/supabaseClient";
import { fetchWazzupStats, type WazzupStats } from "@/lib/wazzup";

const WAZZUP_URL = "https://crm.zoho.com/crm/org712284897/tab/WebTab1";

/** Dashboard "Chats" card with prominent pending alerts: live browser-tab badge,
 *  a toast + spoken voice alert when new chats arrive, and a pulsing red pending
 *  tile. Works while the dashboard tab is open. Polls every 30s. */
export function WazzupCard() {
  const [s, setS] = useState<WazzupStats | null>(null);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const [refreshing, setRefreshing] = useState(false);
  const prevPending = useRef<number | null>(null);
  const baseTitle = useRef<string>("");

  // restore mute pref + base title + notification permission on mount
  useEffect(() => {
    setMuted(localStorage.getItem("wz_muted") === "1");
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
    return () => {
      document.title = baseTitle.current; // restore tab title when leaving
    };
  }, []);

  // Latest-closure alert (captures current `muted`): toast + voice + OS popup,
  // with the customer's name when we have it.
  const notifyRef = useRef<(name?: string | null) => void>(() => {});
  const lastRtAlert = useRef(0);
  useEffect(() => {
    notifyRef.current = (name) => {
      setToast(name ? `${name} · reply within 15 min` : "Reply within 15 min");
      window.setTimeout(() => setToast(null), 9000);
      if (!muted) {
        try {
          const u = new SpeechSynthesisUtterance(name ? `New chat waiting from ${name}, please reply` : "New chat waiting, please reply");
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch { /* speech not available */ }
      }
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification("New chat waiting", { body: name ? `${name} · reply within 15 min` : "Reply within 15 minutes", tag: "wazzup-pending" }); } catch { /* ignore */ }
      }
    };
  });

  // Refresh the displayed numbers + tab-title badge (no alert here).
  const applyRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    applyRef.current = async () => {
      const r = await fetchWazzupStats();
      setS(r);
      document.title = r.pendingChats > 0 ? `(${r.pendingChats}) ${baseTitle.current}` : baseTitle.current;
      prevPending.current = r.pendingChats;
    };
  });

  // Realtime: a new message pushes in ~1s — alert by customer name on inbound.
  useEffect(() => {
    const ch = supabase
      .channel("wazzup_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wazzup_messages" }, (payload) => {
        const row = payload.new as { direction?: string; contact_name?: string | null };
        void applyRef.current();
        if (row?.direction === "inbound") {
          lastRtAlert.current = Date.now();
          notifyRef.current(row.contact_name ?? null);
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Fallback poll — refresh, and a generic alert only if realtime didn't just fire.
  useEffect(() => {
    const tick = async () => {
      const before = prevPending.current;
      await applyRef.current();
      const after = prevPending.current;
      if (before != null && after != null && after > before && Date.now() - lastRtAlert.current > 15_000) {
        notifyRef.current(null);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 30_000);
    return () => clearInterval(id);
  }, []);

  async function refreshNow() {
    setRefreshing(true);
    try { await applyRef.current(); } finally { setRefreshing(false); }
  }

  function toggleMute() {
    setMuted((m) => { localStorage.setItem("wz_muted", m ? "0" : "1"); return !m; });
  }
  async function enableAlerts() {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  }

  const tile = (label: string, value: string, tone: string, sub?: string) => (
    <div className="rounded-xl bg-white/70 p-3 dark:bg-slate-900/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
    </div>
  );

  const pending = s?.pendingChats ?? 0;
  const waitTone = (s?.oldestWaitingMin ?? 0) > 15 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100";
  const pctTone = s?.repliedPct == null ? "text-slate-400" : s.repliedPct >= 90 ? "text-emerald-600 dark:text-emerald-400" : s.repliedPct >= 70 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  return (
    <section className={`${surface} mt-6 p-4`}>
      <style>{`@keyframes wzpulse{0%{box-shadow:0 0 0 0 rgba(225,29,72,.5)}70%{box-shadow:0 0 0 10px rgba(225,29,72,0)}100%{box-shadow:0 0 0 0 rgba(225,29,72,0)}}`}</style>

      {toast ? (
        <div className="fixed right-4 top-4 z-[60] flex max-w-sm items-center gap-3 rounded-lg border border-rose-300 bg-white px-4 py-3 shadow-lg dark:border-rose-900 dark:bg-slate-900" style={{ borderLeftWidth: 3, borderLeftColor: "#e11d48" }}>
          <span aria-hidden="true" className="text-xl">🔔</span>
          <div className="text-sm">
            <p className="font-medium text-slate-900 dark:text-slate-100">New chat waiting</p>
            <p className="text-xs text-slate-500">{toast}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" /> Chats (WhatsApp / Wazzup)
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <button type="button" onClick={refreshNow} disabled={refreshing} title="Refresh now" className="font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:hover:text-slate-300">
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
          {notifPerm === "default" ? (
            <button type="button" onClick={enableAlerts} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Enable pop-up alerts</button>
          ) : null}
          <button type="button" onClick={toggleMute} title={muted ? "Unmute voice alert" : "Mute voice alert"} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            {muted ? "🔕 Muted" : "🔔 Sound on"}
          </button>
          <a href={WAZZUP_URL} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Open Wazzup →</a>
        </div>
      </div>

      {s === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div
            className={`rounded-xl p-3 ${pending > 0 ? "bg-rose-50 dark:bg-rose-950/40" : "bg-white/70 dark:bg-slate-900/40"}`}
            style={pending > 0 ? { animation: "wzpulse 1.8s infinite" } : undefined}
          >
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${pending > 0 ? "text-rose-600 dark:text-rose-300" : "text-slate-500"}`}>Pending chats</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${pending > 0 ? "text-rose-600 dark:text-rose-300" : "text-slate-900 dark:text-slate-100"}`}>{pending}</p>
            <p className={`text-xs ${pending > 0 ? "text-rose-500" : "text-slate-400"}`}>awaiting reply</p>
          </div>
          {tile("Oldest waiting", s.oldestWaitingMin ? `${s.oldestWaitingMin}m` : "—", waitTone, s.oldestWaitingMin > 15 ? "over 15 min" : "within SLA")}
          {tile("New today", String(s.newToday), "text-slate-900 dark:text-slate-100", "chats")}
          {tile("Replied <15 min", s.repliedPct == null ? "—" : `${s.repliedPct}%`, pctTone, s.repliedTotal ? `of ${s.repliedTotal} (7d)` : "no data yet")}
        </div>
      )}
    </section>
  );
}
