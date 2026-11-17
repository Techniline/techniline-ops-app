"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/app/providers/AuthProvider";
import { isManager } from "@/lib/permissions";
import {
  AARON_ID,
  MARICEL_ID,
  STANDUP_USERS,
  type StandupItem,
  type StandupLog,
  fetchStandupLog,
  fetchPrevLog,
  fetchStandupsByDate,
  fetchOpenBlockers,
  upsertStandupLog,
  buildWhatsAppText,
  buildMeetingSummary,
  dubaiToday,
  fmtDate,
} from "@/lib/standup";

// ─── tiny helpers ────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyItem(text = ""): StandupItem {
  return { id: uid(), text, status: "pending" };
}

function prevDay(d: string): string {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function nextDay(d: string): string {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// ─── item editor component ───────────────────────────────────────────────────

function ItemEditor({
  item,
  onUpdate,
  onRemove,
  placeholder,
  accent,
}: {
  item: StandupItem;
  onUpdate: (updated: StandupItem) => void;
  onRemove: () => void;
  placeholder: string;
  accent: string;
}) {
  const [expanded, setExpanded] = useState(!!item.detail);
  return (
    <div className={`group rounded-xl border ${accent}-border bg-white/60 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden`}>
      <div className="flex items-start gap-2 p-3">
        <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${accent}-dot`} />
        <input
          className="flex-1 bg-transparent text-sm font-medium text-gray-800 placeholder-gray-400 outline-none"
          value={item.text}
          onChange={(e) => onUpdate({ ...item, text: e.target.value })}
          placeholder={placeholder}
        />
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-gray-400 hover:text-gray-600 text-xs px-1.5 py-0.5 rounded-md hover:bg-gray-100 transition-colors"
          title="Add detail"
        >
          {expanded ? "▲" : "▼ detail"}
        </button>
        <button
          onClick={onRemove}
          className="text-gray-300 hover:text-red-400 transition-colors text-sm leading-none opacity-0 group-hover:opacity-100"
          title="Remove"
        >
          ×
        </button>
      </div>
      {expanded && (
        <div className="px-7 pb-3">
          <textarea
            rows={2}
            className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 outline-none resize-none placeholder-gray-400"
            value={item.detail ?? ""}
            onChange={(e) => onUpdate({ ...item, detail: e.target.value || undefined })}
            placeholder="Add detail, link, or context…"
          />
        </div>
      )}
    </div>
  );
}

// ─── yesterday item (read-only with done/carry actions) ─────────────────────

function YesterdayItem({
  item,
  onMark,
}: {
  item: StandupItem;
  onMark: (status: "done" | "carried") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDone = item.status === "done";
  const isCarried = item.status === "carried";
  return (
    <div className={`rounded-xl border p-3 transition-all ${
      isDone ? "border-emerald-200 bg-emerald-50/60" :
      isCarried ? "border-amber-200 bg-amber-50/60" :
      "border-gray-200 bg-white/70"
    }`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-sm">{isDone ? "✅" : isCarried ? "➡️" : "⬜"}</span>
        <div className="flex-1">
          <p className={`text-sm font-medium ${isDone ? "line-through text-gray-400" : "text-gray-800"}`}>
            {item.text}
          </p>
          {item.detail && (
            <button onClick={() => setExpanded((x) => !x)} className="text-xs text-gray-400 mt-0.5 hover:text-gray-600">
              {expanded ? "▲ hide" : "▼ details"}
            </button>
          )}
          {expanded && item.detail && (
            <p className="text-xs text-gray-500 mt-1 italic">{item.detail}</p>
          )}
          {item.carriedFrom && (
            <p className="text-xs text-amber-500 mt-0.5">↩ from {fmtDate(item.carriedFrom)}</p>
          )}
        </div>
        {!isDone && !isCarried && (
          <div className="flex gap-1.5 ml-auto flex-shrink-0">
            <button
              onClick={() => onMark("done")}
              className="text-xs px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors font-medium"
            >
              Done ✓
            </button>
            <button
              onClick={() => onMark("carried")}
              className="text-xs px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors font-medium"
            >
              Carry → today
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── scrum summary card ──────────────────────────────────────────────────────

function ScrumCard({ log, name, color }: { log: StandupLog; name: string; color: string }) {
  const [copied, setCopied] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const text = buildWhatsAppText(log, name);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select textarea
    }
  }

  const colorMap: Record<string, string> = {
    blue:   "from-blue-500 to-indigo-600",
    violet: "from-violet-500 to-purple-600",
  };

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colorMap[color] ?? "from-gray-500 to-gray-700"} p-0.5 shadow-lg`}>
      <div className="rounded-2xl bg-white/95 backdrop-blur p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 text-base">📋 Scrum Summary</h3>
            <p className="text-xs text-gray-500">{fmtDate(log.log_date)}</p>
          </div>
          <button
            onClick={handleCopy}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              copied
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-900 text-white hover:bg-gray-700"
            }`}
          >
            {copied ? "✓ Copied!" : "📱 Copy for WhatsApp"}
          </button>
        </div>

        {/* Sections */}
        {[
          { key: "yesterday", label: "✅ Yesterday", items: log.yesterday_items, accent: "emerald" },
          { key: "today",     label: "📋 Today",     items: log.today_items,     accent: "blue"    },
          { key: "blockers",  label: "🚫 Blockers",  items: log.blocker_items,   accent: "red"     },
        ].map(({ key, label, items, accent }) => (
          items.length > 0 && (
            <div key={key}>
              <button
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900 w-full text-left"
                onClick={() => setOpenSection(openSection === key ? null : key)}
              >
                <span>{label}</span>
                <span className={`ml-1 text-xs font-normal px-1.5 py-0.5 rounded-full bg-${accent}-100 text-${accent}-700`}>{items.length}</span>
                <span className="ml-auto text-gray-400 text-xs">{openSection === key ? "▲" : "▼"}</span>
              </button>
              {openSection === key && (
                <ul className="mt-2 space-y-1 pl-4">
                  {items.map((item) => (
                    <li key={item.id} className="text-sm text-gray-700">
                      <span className="font-medium">• {item.text}</span>
                      {item.detail && <span className="text-gray-400 ml-1 text-xs">— {item.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        ))}
      </div>
    </div>
  );
}

// ─── single-user standup form ────────────────────────────────────────────────

function StandupForm({
  userId,
  date,
  isOwnLog,
}: {
  userId: string;
  date: string;
  isOwnLog: boolean;
}) {
  const info = STANDUP_USERS[userId];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [log, setLog] = useState<StandupLog | null>(null);
  const [yesterdayItems, setYesterdayItems] = useState<StandupItem[]>([]);
  const [todayItems, setTodayItems] = useState<StandupItem[]>([emptyItem()]);
  const [blockerItems, setBlockerItems] = useState<StandupItem[]>([]);
  const [suggestedBlockers, setSuggestedBlockers] = useState<{ id: string; what: string }[]>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLog = useCallback(async () => {
    setLoading(true);
    try {
      // Load today's existing log
      const existing = await fetchStandupLog(userId, date);
      if (existing) {
        setLog(existing);
        setYesterdayItems(existing.yesterday_items);
        setTodayItems(existing.today_items.length > 0 ? existing.today_items : [emptyItem()]);
        setBlockerItems(existing.blocker_items);
      } else {
        // No log yet — auto-fill from previous day
        const prev = await fetchPrevLog(userId, date);
        const prevDate = prev?.log_date ?? prevDay(date);

        // Yesterday = previous day's "today" items (all as pending, awaiting done/carry mark)
        const autoYesterday: StandupItem[] = (prev?.today_items ?? []).map((item) => ({
          ...item,
          id: uid(),
          status: "pending" as const,
          carriedFrom: prevDate,
        }));
        setYesterdayItems(autoYesterday);
        setTodayItems([emptyItem()]);
        setBlockerItems([]);
        setLog(null);
      }

      if (isOwnLog) {
        const blockers = await fetchOpenBlockers(userId);
        setSuggestedBlockers(blockers);
      }
    } finally {
      setLoading(false);
    }
  }, [userId, date, isOwnLog]);

  useEffect(() => { loadLog(); }, [loadLog]);

  async function save(
    y = yesterdayItems,
    t = todayItems,
    b = blockerItems
  ) {
    setSaving(true);
    try {
      const saved_ = await upsertStandupLog(userId, date, {
        yesterday_items: y,
        today_items: t.filter((i) => i.text.trim()),
        blocker_items: b.filter((i) => i.text.trim()),
      });
      setLog(saved_);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Standup save failed", e);
    } finally {
      setSaving(false);
    }
  }

  function scheduleAutoSave(y = yesterdayItems, t = todayItems, b = blockerItems) {
    if (!isOwnLog) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => save(y, t, b), 1500);
  }

  function markYesterday(id: string, status: "done" | "carried") {
    const updated = yesterdayItems.map((item) =>
      item.id === id ? { ...item, status } : item
    );
    // If carried, also prepend to today's list
    let updatedToday = todayItems;
    if (status === "carried") {
      const src = yesterdayItems.find((i) => i.id === id);
      if (src) {
        const carried: StandupItem = {
          id: uid(),
          text: src.text,
          detail: src.detail,
          status: "carried",
          carriedFrom: src.carriedFrom ?? prevDay(date),
        };
        updatedToday = [carried, ...todayItems];
        setTodayItems(updatedToday);
      }
    }
    setYesterdayItems(updated);
    scheduleAutoSave(updated, updatedToday, blockerItems);
  }

  function addYesterdayItem() {
    setYesterdayItems((prev) => [...prev, emptyItem()]);
  }

  function updateYesterdayItem(id: string, updated: StandupItem) {
    const list = yesterdayItems.map((i) => (i.id === id ? updated : i));
    setYesterdayItems(list);
    scheduleAutoSave(list, todayItems, blockerItems);
  }

  function removeYesterdayItem(id: string) {
    const list = yesterdayItems.filter((i) => i.id !== id);
    setYesterdayItems(list);
    scheduleAutoSave(list, todayItems, blockerItems);
  }

  function addTodayItem(text = "") {
    const list = [...todayItems, emptyItem(text)];
    setTodayItems(list);
    scheduleAutoSave(yesterdayItems, list, blockerItems);
  }

  function updateTodayItem(id: string, updated: StandupItem) {
    const list = todayItems.map((i) => (i.id === id ? updated : i));
    setTodayItems(list);
    scheduleAutoSave(yesterdayItems, list, blockerItems);
  }

  function removeTodayItem(id: string) {
    const list = todayItems.filter((i) => i.id !== id);
    setTodayItems(list.length > 0 ? list : [emptyItem()]);
    scheduleAutoSave(yesterdayItems, todayItems.filter((i) => i.id !== id), blockerItems);
  }

  function addBlockerItem(text = "") {
    const list = [...blockerItems, emptyItem(text)];
    setBlockerItems(list);
    scheduleAutoSave(yesterdayItems, todayItems, list);
  }

  function updateBlockerItem(id: string, updated: StandupItem) {
    const list = blockerItems.map((i) => (i.id === id ? updated : i));
    setBlockerItems(list);
    scheduleAutoSave(yesterdayItems, todayItems, list);
  }

  function removeBlockerItem(id: string) {
    const list = blockerItems.filter((i) => i.id !== id);
    setBlockerItems(list);
    scheduleAutoSave(yesterdayItems, todayItems, list);
  }

  function addSuggestedBlocker(what: string) {
    const list = [...blockerItems, emptyItem(what)];
    setBlockerItems(list);
    scheduleAutoSave(yesterdayItems, todayItems, list);
  }

  const colorMap: Record<string, { grad: string; border: string; dot: string }> = {
    blue:   { grad: "from-blue-500 to-indigo-600",     border: "border-blue-200",   dot: "bg-blue-400"   },
    violet: { grad: "from-violet-500 to-purple-600",   border: "border-violet-200", dot: "bg-violet-400" },
  };
  const c = colorMap[info?.color ?? "blue"];

  if (loading) {
    return (
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-8 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  const hasContent = yesterdayItems.some((i) => i.text.trim()) ||
    todayItems.some((i) => i.text.trim()) ||
    blockerItems.some((i) => i.text.trim());

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className={`rounded-2xl bg-gradient-to-br ${c.grad} p-0.5 shadow-md`}>
        <div className="rounded-2xl bg-white/95 p-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isOwnLog ? "My Standup" : `${info?.name}'s Standup`}
            </h2>
            <p className="text-sm text-gray-500">{fmtDate(date)}</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-xs text-emerald-600 font-medium animate-pulse">✓ Saved</span>
            )}
            {isOwnLog && (
              <button
                onClick={() => save()}
                disabled={saving}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  saving
                    ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                    : `bg-gradient-to-r ${c.grad} text-white shadow hover:shadow-md`
                }`}
              >
                {saving ? "Saving…" : "Save log"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Yesterday */}
      <Section
        title="Yesterday"
        emoji="✅"
        color="emerald"
        addLabel={isOwnLog ? "+ Add item" : undefined}
        onAdd={isOwnLog ? addYesterdayItem : undefined}
      >
        {yesterdayItems.length === 0 && (
          <p className="text-sm text-gray-400 italic px-1">No items from yesterday yet.</p>
        )}
        {yesterdayItems.map((item) =>
          isOwnLog ? (
            <div key={item.id} className="space-y-1">
              {item.status === "pending" && item.carriedFrom ? (
                <YesterdayItem item={item} onMark={(s) => markYesterday(item.id, s)} />
              ) : (
                <ItemEditor
                  item={item}
                  onUpdate={(u) => updateYesterdayItem(item.id, u)}
                  onRemove={() => removeYesterdayItem(item.id)}
                  placeholder="What did you complete?"
                  accent="emerald"
                />
              )}
            </div>
          ) : (
            <ReadonlyItem key={item.id} item={item} />
          )
        )}
      </Section>

      {/* Today */}
      <Section
        title="Today"
        emoji="📋"
        color="blue"
        addLabel={isOwnLog ? "+ Add item" : undefined}
        onAdd={isOwnLog ? () => addTodayItem() : undefined}
      >
        {todayItems.map((item) =>
          isOwnLog ? (
            <ItemEditor
              key={item.id}
              item={item}
              onUpdate={(u) => updateTodayItem(item.id, u)}
              onRemove={() => removeTodayItem(item.id)}
              placeholder="What will you work on today?"
              accent="blue"
            />
          ) : (
            <ReadonlyItem key={item.id} item={item} />
          )
        )}
      </Section>

      {/* Blockers */}
      <Section
        title="Blockers"
        emoji="🚫"
        color="red"
        addLabel={isOwnLog ? "+ Add blocker" : undefined}
        onAdd={isOwnLog ? () => addBlockerItem() : undefined}
      >
        {blockerItems.length === 0 && !isOwnLog && (
          <p className="text-sm text-gray-400 italic px-1">No blockers reported.</p>
        )}
        {blockerItems.map((item) =>
          isOwnLog ? (
            <ItemEditor
              key={item.id}
              item={item}
              onUpdate={(u) => updateBlockerItem(item.id, u)}
              onRemove={() => removeBlockerItem(item.id)}
              placeholder="Describe the blocker…"
              accent="red"
            />
          ) : (
            <ReadonlyItem key={item.id} item={item} />
          )
        )}

        {/* Suggested from blockers table */}
        {isOwnLog && suggestedBlockers.length > 0 && (
          <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs font-semibold text-amber-700 mb-2">📌 Open blockers from your tracker</p>
            <div className="space-y-1">
              {suggestedBlockers.map((b) => (
                <button
                  key={b.id}
                  onClick={() => addBlockerItem(b.what)}
                  className="w-full text-left text-xs text-amber-800 hover:text-amber-900 hover:bg-amber-100 rounded-lg px-2 py-1 transition-colors"
                >
                  + {b.what}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Scrum card */}
      {hasContent && log && (
        <ScrumCard
          log={{ ...log, yesterday_items: yesterdayItems, today_items: todayItems, blocker_items: blockerItems }}
          name={info?.name ?? "Team"}
          color={info?.color ?? "blue"}
        />
      )}
    </div>
  );
}

// ─── readonly item ────────────────────────────────────────────────────────────

function ReadonlyItem({ item }: { item: StandupItem }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = item.status === "done";
  const isCarried = item.status === "carried";
  return (
    <div className={`rounded-xl px-3 py-2.5 border text-sm transition-all ${
      isDone ? "border-emerald-100 bg-emerald-50/50 text-gray-500" :
      isCarried ? "border-amber-100 bg-amber-50/50" :
      "border-gray-100 bg-white/60"
    }`}>
      <div className="flex items-start gap-2">
        <span>{isDone ? "✅" : isCarried ? "➡️" : "•"}</span>
        <div className="flex-1">
          <p className={`font-medium ${isDone ? "line-through text-gray-400" : "text-gray-800"}`}>{item.text}</p>
          {item.detail && (
            <button onClick={() => setExpanded((x) => !x)} className="text-xs text-gray-400 mt-0.5 hover:text-gray-600">
              {expanded ? "▲ hide" : "▼ detail"}
            </button>
          )}
          {expanded && item.detail && <p className="text-xs text-gray-500 mt-1 italic">{item.detail}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  emoji,
  color,
  children,
  addLabel,
  onAdd,
}: {
  title: string;
  emoji: string;
  color: string;
  children: React.ReactNode;
  addLabel?: string;
  onAdd?: () => void;
}) {
  const colorStyles: Record<string, string> = {
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-100",
    blue:    "text-blue-700 bg-blue-50 border-blue-100",
    red:     "text-red-700 bg-red-50 border-red-100",
  };
  const hoverStyles: Record<string, string> = {
    emerald: "text-emerald-600 hover:bg-emerald-50",
    blue:    "text-blue-600 hover:bg-blue-50",
    red:     "text-red-600 hover:bg-red-50",
  };
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden">
      <div className={`px-4 py-3 border-b ${colorStyles[color]} flex items-center justify-between`}>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <span>{emoji}</span> {title}
        </h3>
      </div>
      <div className="p-4 space-y-2">
        {children}
        {onAdd && (
          <button
            onClick={onAdd}
            className={`w-full text-xs font-medium py-2 rounded-xl border border-dashed transition-colors ${hoverStyles[color]} border-current`}
          >
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── manager overview ─────────────────────────────────────────────────────────

function ManagerOverview({ date }: { date: string }) {
  const [logs, setLogs] = useState<Record<string, StandupLog>>({});
  const [loading, setLoading] = useState(true);
  const [meetingCopied, setMeetingCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchStandupsByDate(date)
      .then((rows) => {
        const map: Record<string, StandupLog> = {};
        for (const row of rows) map[row.user_id] = row;
        setLogs(map);
      })
      .finally(() => setLoading(false));
  }, [date]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-gray-200 border-t-indigo-500 rounded-full" />
      </div>
    );
  }

  const users = [
    { id: AARON_ID,   ...STANDUP_USERS[AARON_ID]   },
    { id: MARICEL_ID, ...STANDUP_USERS[MARICEL_ID] },
  ];

  const hasAny = users.some((u) => logs[u.id]);

  async function copyMeetingSummary() {
    const entries = users.map((u) => ({
      log: logs[u.id] ?? {
        id: "", user_id: u.id, log_date: date,
        yesterday_items: [], today_items: [], blocker_items: [],
        created_at: "", updated_at: "",
      },
      name: u.name,
    }));
    const text = buildMeetingSummary(entries);
    try {
      await navigator.clipboard.writeText(text);
      setMeetingCopied(true);
      setTimeout(() => setMeetingCopied(false), 2500);
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      {/* KPI snapshot bar + meeting export */}
      <div className="grid grid-cols-2 gap-4">
        {users.map((u) => {
          const log = logs[u.id];
          const colorMap: Record<string, string> = {
            blue:   "from-blue-500 to-indigo-600",
            violet: "from-violet-500 to-purple-600",
          };
          return (
            <div key={u.id} className={`rounded-xl bg-gradient-to-br ${colorMap[u.color]} p-0.5 shadow`}>
              <div className="rounded-xl bg-white/95 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-900">{u.name}</p>
                  <p className="text-xs text-gray-500">
                    {log
                      ? `${log.today_items.filter((i) => i.text).length} today · ${log.blocker_items.filter((i) => i.text).length} blockers`
                      : "No log submitted"}
                  </p>
                </div>
                <div className={`w-2.5 h-2.5 rounded-full ${log ? "bg-emerald-400" : "bg-gray-300"}`} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Meeting export card */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-0.5 shadow-lg">
        <div className="rounded-2xl bg-white/97 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-bold text-gray-900">📤 Share in Meeting</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Copies the full combined standup for both Aaron and Maricel — ready to paste into WhatsApp, Teams, or the meeting chat.
            </p>
          </div>
          <button
            onClick={copyMeetingSummary}
            className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow ${
              meetingCopied
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:shadow-md"
            }`}
          >
            {meetingCopied ? "✓ Copied!" : "📋 Copy team standup"}
          </button>
        </div>
      </div>

      {!hasAny && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">No standups submitted for {fmtDate(date)} yet.</p>
          <p className="text-sm mt-1">Aaron and Maricel will fill theirs during the morning scrum.</p>
        </div>
      )}

      {/* Side-by-side logs */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {users.map((u) => {
          const log = logs[u.id];
          return (
            <div key={u.id}>
              <StandupForm userId={u.id} date={date} isOwnLog={false} />
              {log && (
                <div className="mt-4">
                  <ScrumCard log={log} name={u.name} color={u.color} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function StandupPage() {
  const { profile } = useAuth();
  const [date, setDate] = useState(dubaiToday());
  const today = dubaiToday();
  const manager = profile ? isManager(profile) : false;
  const isAaron   = profile?.id === AARON_ID;
  const isMaricel = profile?.id === MARICEL_ID;
  const canAccess = manager || isAaron || isMaricel;

  if (!profile) return null;
  if (!canAccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-500">You don&apos;t have access to the standup log.</p>
      </div>
    );
  }

  const isToday = date === today;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Link
            href="/dashboard"
            className="mt-1 flex items-center justify-center w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
            title="Back to Dashboard"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {manager ? "Standup Overview" : "Daily Standup"}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {manager
                ? "Aaron and Maricel's morning scrum logs"
                : "Log your yesterday, today, and blockers"}
            </p>
          </div>
        </div>

        {/* Date navigator */}
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
          <button
            onClick={() => setDate(prevDay(date))}
            className="text-gray-400 hover:text-gray-700 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100"
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm font-medium text-gray-800 outline-none bg-transparent"
          />
          <button
            onClick={() => { if (!isToday) setDate(nextDay(date)); }}
            disabled={isToday}
            className="text-gray-400 hover:text-gray-700 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ›
          </button>
          {!isToday && (
            <button
              onClick={() => setDate(today)}
              className="text-xs text-blue-600 font-medium hover:underline ml-1"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {manager ? (
        <ManagerOverview date={date} />
      ) : (
        <StandupForm
          userId={profile.id}
          date={date}
          isOwnLog={true}
        />
      )}
    </div>
  );
}
