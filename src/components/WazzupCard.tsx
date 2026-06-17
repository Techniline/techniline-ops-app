"use client";

import { useEffect, useRef, useState } from "react";

import { surface } from "@/components/ui";
import { supabase } from "@/lib/supabaseClient";
import { fetchWazzupStats, resolveWazzupChat, type WazzupStats } from "@/lib/wazzup";

const WAZZUP_URL = "https://crm.zoho.com/crm/org712284897/tab/WebTab1";

/** Dashboard "Chats" card: live numbers (pending, oldest wait, new today, 15-min
 *  KPI) with a pulsing red pending tile and the waiting customer's name. Polls
 *  every 15s. The actual toast/voice/tab-badge alerting lives in the app-wide
 *  <WazzupAlerts/> watcher so it fires on every page, not just here. */
export function WazzupCard() {
  const [s, setS] = useState<WazzupStats | null>(null);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const [refreshing, setRefreshing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  // restore mute pref + notification permission on mount
  useEffect(() => {
    setMuted(localStorage.getItem("wz_muted") === "1");
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
  }, []);

  // Refresh the displayed numbers. Alerting is handled globally by <WazzupAlerts/>.
  const applyRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    applyRef.current = async () => { setS(await fetchWazzupStats()); };
  });

  // Fast poll (every 15s) — primary mechanism. Realtime is a bonus nudge on top.
  useEffect(() => {
    void applyRef.current();
    const id = setInterval(() => void applyRef.current(), 15_000);
    const ch = supabase
      .channel("wazzup_live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wazzup_messages" }, () => void applyRef.current())
      .subscribe();
    return () => { clearInterval(id); void supabase.removeChannel(ch); };
  }, []);

  async function refreshNow() {
    setRefreshing(true);
    try { await applyRef.current(); } finally { setRefreshing(false); }
  }

  async function resolve(chatId: string, action: "replied" | "no_reply_needed") {
    setResolvingId(chatId);
    setResolveErr(null);
    try {
      await resolveWazzupChat(chatId, action);
      await applyRef.current();
    } catch (e) {
      setResolveErr(e instanceof Error ? e.message : "Could not update — try again.");
    } finally { setResolvingId(null); }
  }

  // Explicit test — always shows the toast and speaks (the click satisfies the
  // browser's audio-gesture requirement), regardless of the mute toggle.
  function testAlert() {
    setToast("Test customer · reply within 15 min");
    window.setTimeout(() => setToast(null), 9000);
    try {
      const u = new SpeechSynthesisUtterance("New chat waiting from test customer, please reply");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* speech not available */ }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification("New chat waiting", { body: "Test customer · reply within 15 min", tag: "wazzup-test" }); } catch { /* ignore */ }
    }
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
          <button type="button" onClick={() => setManaging(true)} title="Mark chats replied / no reply needed" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Manage</button>
          <button type="button" onClick={testAlert} title="Play a test alert" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">🔊 Test</button>
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
            <button
              type="button"
              onClick={() => setManaging(true)}
              className={`mt-0.5 text-left text-xs ${pending > 0 ? "text-rose-500 hover:underline" : "text-slate-400"}`}
            >
              {pending > 0 && s && s.pendingNames.length
                ? `waiting: ${s.pendingNames.slice(0, 2).join(", ")}${s.pendingNames.length > 2 ? ` +${s.pendingNames.length - 2}` : ""} · manage`
                : "awaiting reply"}
            </button>
          </div>
          {tile("Oldest waiting", s.oldestWaitingMin ? `${s.oldestWaitingMin}m` : "—", waitTone, s.oldestWaitingMin > 15 ? "over 15 min" : "within SLA")}
          {tile("New today", String(s.newToday), "text-slate-900 dark:text-slate-100", "chats")}
          {tile("Replied <15 min", s.repliedPct == null ? "—" : `${s.repliedPct}%`, pctTone, s.repliedTotal ? `of ${s.repliedTotal} (7d)` : "no data yet")}
        </div>
      )}

      {managing ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={() => setManaging(false)}>
          <div className={`${surface} w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Pending customers</h2>
                <p className="text-xs text-slate-500">Mark each as replied, or no reply needed, to clear it.</p>
              </div>
              <button type="button" onClick={() => setManaging(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-auto px-5 py-3">
              {resolveErr ? (
                <div className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{resolveErr}</div>
              ) : null}
              {!s || s.pending.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No one waiting. 🎉</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {s.pending.map((p) => (
                    <li key={p.chatId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{p.name}</p>
                        {p.at ? <p className="text-[11px] text-slate-400">{new Date(p.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" disabled={resolvingId === p.chatId} onClick={() => void resolve(p.chatId, "replied")}
                          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Replied</button>
                        <button type="button" disabled={resolvingId === p.chatId} onClick={() => void resolve(p.chatId, "no_reply_needed")}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">No reply needed</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
              <button type="button" onClick={() => setManaging(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
