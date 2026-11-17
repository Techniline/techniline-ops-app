"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
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

// ─── bullet textarea ─────────────────────────────────────────────────────────

function BulletTextarea({
  items,
  onChange,
  placeholder,
  accent,
}: {
  items: StandupItem[];
  onChange: (items: StandupItem[]) => void;
  placeholder: string;
  accent: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Derive initial text from items
  const toText = (its: StandupItem[]) =>
    its.filter((i) => i.text).map((i) => i.text).join("\n");

  const [text, setText] = useState(() => toText(items));

  // Sync when items change externally (e.g., carried item prepended)
  const itemsKey = items.map((i) => i.id + ":" + i.text).join("|");
  useEffect(() => {
    setText(toText(items));
  }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight, 72) + "px";
  }, [text]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);

    // Map lines → StandupItems, reusing existing IDs when text matches
    const existingByText = new Map(items.map((i) => [i.text, i]));
    const newItems = val
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => existingByText.get(line) ?? emptyItem(line));

    onChange(newItems);
  }

  const borderMap: Record<string, string> = {
    blue:    "border-blue-200 focus:border-blue-400 focus:ring-blue-100",
    red:     "border-red-200 focus:border-red-400 focus:ring-red-100",
    emerald: "border-emerald-200 focus:border-emerald-400 focus:ring-emerald-100",
  };

  const count = text.split("\n").filter((l) => l.trim()).length;

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        className={`w-full text-sm text-gray-800 bg-white/80 border ${borderMap[accent] ?? "border-gray-200 focus:border-blue-400 focus:ring-blue-100"} rounded-xl px-4 py-3 outline-none resize-none placeholder-gray-400 focus:ring-2 transition-all leading-relaxed`}
        style={{ minHeight: "72px", overflow: "hidden" }}
      />
      {count > 0 && (
        <span className="absolute top-2.5 right-3 text-xs text-gray-300 pointer-events-none select-none">
          {count}
        </span>
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
        setTodayItems(existing.today_items);
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
        setTodayItems([]);
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

  // Manual yesterday items = those without carriedFrom (user-typed, not auto-filled)
  function setManualYesterdayItems(newManual: StandupItem[]) {
    const autoItems = yesterdayItems.filter((i) => i.carriedFrom);
    const updated = [...autoItems, ...newManual];
    setYesterdayItems(updated);
    scheduleAutoSave(updated, todayItems, blockerItems);
  }

  function setTodayFromTextarea(newItems: StandupItem[]) {
    setTodayItems(newItems);
    scheduleAutoSave(yesterdayItems, newItems, blockerItems);
  }

  function setBlockersFromTextarea(newItems: StandupItem[]) {
    setBlockerItems(newItems);
    scheduleAutoSave(yesterdayItems, todayItems, newItems);
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
      <Section title="Yesterday" emoji="✅" color="emerald">
        {yesterdayItems.length === 0 && !isOwnLog && (
          <p className="text-sm text-gray-400 italic px-1">No items from yesterday yet.</p>
        )}
        {/* Auto-filled cards (from previous day's Today list) */}
        {yesterdayItems
          .filter((item) => item.carriedFrom)
          .map((item) =>
            isOwnLog ? (
              <YesterdayItem key={item.id} item={item} onMark={(s) => markYesterday(item.id, s)} />
            ) : (
              <ReadonlyItem key={item.id} item={item} />
            )
          )}
        {/* Manually-added yesterday items via textarea */}
        {isOwnLog ? (
          <BulletTextarea
            items={yesterdayItems.filter((i) => !i.carriedFrom)}
            onChange={setManualYesterdayItems}
            placeholder={"Each line = one thing you completed yesterday\n• Responded to customer queries\n• Fixed invoice bug"}
            accent="emerald"
          />
        ) : (
          yesterdayItems
            .filter((i) => !i.carriedFrom)
            .map((item) => <ReadonlyItem key={item.id} item={item} />)
        )}
      </Section>

      {/* Today */}
      <Section title="Today" emoji="📋" color="blue">
        {isOwnLog ? (
          <BulletTextarea
            items={todayItems}
            onChange={setTodayFromTextarea}
            placeholder={"Each line = one task for today\n• Follow up on shipment #1234\n• Review Amazon listings"}
            accent="blue"
          />
        ) : (
          <>
            {todayItems.length === 0 && (
              <p className="text-sm text-gray-400 italic px-1">No tasks logged.</p>
            )}
            {todayItems.map((item) => <ReadonlyItem key={item.id} item={item} />)}
          </>
        )}
      </Section>

      {/* Blockers */}
      <Section title="Blockers" emoji="🚫" color="red">
        {isOwnLog ? (
          <BulletTextarea
            items={blockerItems}
            onChange={setBlockersFromTextarea}
            placeholder={"Each line = one blocker (leave empty if none)\n• Waiting for supplier quote\n• Access needed for portal"}
            accent="red"
          />
        ) : (
          <>
            {blockerItems.length === 0 && (
              <p className="text-sm text-gray-400 italic px-1">No blockers reported.</p>
            )}
            {blockerItems.map((item) => <ReadonlyItem key={item.id} item={item} />)}
          </>
        )}

        {/* Suggested from blockers table */}
        {isOwnLog && suggestedBlockers.length > 0 && (
          <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs font-semibold text-amber-700 mb-2">📌 Open blockers from your tracker</p>
            <div className="space-y-1">
              {suggestedBlockers.map((b) => (
                <button
                  key={b.id}
                  onClick={() => addSuggestedBlocker(b.what)}
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

interface SavedChannel {
  id: string;
  name: string;
  team_id: string;
  channel_id: string;
}

/** Parse a Teams channel URL to extract teamId + channelId.
 *  Handles both the deep-link format and the web URL format.
 *  Example: https://teams.microsoft.com/l/channel/19%3A...%40thread.tacv2/...?groupId=...&tenantId=...
 */
function parseTeamsUrl(url: string): { teamId: string; channelId: string } | null {
  try {
    const u = new URL(url);
    // Deep link: /l/channel/{channelId}/{name}?groupId={teamId}
    const dlMatch = u.pathname.match(/\/l\/channel\/([^/]+)/);
    const teamId = u.searchParams.get("groupId");
    if (dlMatch && teamId) {
      return { teamId, channelId: decodeURIComponent(dlMatch[1]) };
    }
    // Web URL: /teams/{teamId}/channels/{channelId}
    const webMatch = u.pathname.match(/\/teams\/([^/]+)\/channels\/([^/]+)/);
    if (webMatch) return { teamId: webMatch[1], channelId: webMatch[2] };
  } catch { /* ignore */ }
  return null;
}

function TeamsShareModal({
  summaryText,
  token,
  onClose,
}: {
  summaryText: string;
  token: string;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<SavedChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [selected, setSelected] = useState<SavedChannel | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Add channel form
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [addTeamId, setAddTeamId] = useState("");
  const [addChannelId, setAddChannelId] = useState("");
  const [addMode, setAddMode] = useState<"url" | "manual">("url");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function loadChannels() {
    setLoadingChannels(true);
    fetch("/api/standup/teams-channels", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.channels) setChannels(d.channels); })
      .finally(() => setLoadingChannels(false));
  }

  useEffect(() => { loadChannels(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-parse URL as user types
  useEffect(() => {
    if (addMode !== "url") return;
    const parsed = parseTeamsUrl(addUrl.trim());
    if (parsed) {
      setAddTeamId(parsed.teamId);
      setAddChannelId(parsed.channelId);
      setAddError(null);
    } else if (addUrl.trim()) {
      setAddTeamId("");
      setAddChannelId("");
    }
  }, [addUrl, addMode]);

  async function handleAdd() {
    const teamId = addTeamId.trim();
    const channelId = addChannelId.trim();
    const name = addName.trim();
    if (!teamId || !channelId || !name) {
      setAddError("Fill in all fields.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/standup/teams-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, team_id: teamId, channel_id: channelId }),
      });
      const d = await res.json();
      if (!res.ok) { setAddError(d.error ?? "Failed to save"); return; }
      setAddUrl(""); setAddName(""); setAddTeamId(""); setAddChannelId("");
      setShowAdd(false);
      loadChannels();
    } catch { setAddError("Network error"); }
    finally { setAdding(false); }
  }

  async function handleRemove(id: string) {
    await fetch(`/api/standup/teams-channels?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setChannels((prev) => prev.filter((c) => c.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  async function handleSend() {
    if (!selected) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/standup/share-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          teamId: selected.team_id,
          channelId: selected.channel_id,
          channelName: selected.name,
          summaryText,
        }),
      });
      const data = await res.json();
      if (!res.ok) setSendError(data.error ?? "Failed to send");
      else setSent(selected.name);
    } catch { setSendError("Network error"); }
    finally { setSending(false); }
  }

  const urlParsed = addMode === "url" && !!parseTeamsUrl(addUrl.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold">🟣 Share to Teams</h3>
            <p className="text-indigo-100 text-xs">Post standup to a channel</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {sent ? (
            <div className="text-center py-8 space-y-3">
              <div className="text-5xl">✅</div>
              <p className="font-semibold text-gray-900">Posted to Teams!</p>
              <p className="text-sm text-gray-500">{sent}</p>
              <button onClick={onClose} className="mt-2 px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Saved channels */}
              {loadingChannels ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <div className="animate-spin w-4 h-4 border-2 border-gray-200 border-t-indigo-500 rounded-full" />
                  <span className="text-sm text-gray-400">Loading…</span>
                </div>
              ) : channels.length === 0 ? (
                <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 text-center">
                  <p className="text-sm text-indigo-700 font-medium">No channels saved yet</p>
                  <p className="text-xs text-indigo-500 mt-0.5">Add your first channel below</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">Saved channels</p>
                  {channels.map((ch) => {
                    const isSel = selected?.id === ch.id;
                    return (
                      <div
                        key={ch.id}
                        className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                          isSel
                            ? "border-indigo-400 bg-indigo-50"
                            : "border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40"
                        }`}
                        onClick={() => setSelected(isSel ? null : ch)}
                      >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSel ? "bg-indigo-500" : "bg-gray-300"}`} />
                        <span className={`flex-1 text-sm font-medium ${isSel ? "text-indigo-800" : "text-gray-700"}`}>
                          {ch.name}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemove(ch.id); }}
                          className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-base leading-none"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add channel */}
              {showAdd ? (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                  <p className="text-sm font-semibold text-indigo-800">Add a channel</p>

                  {/* Mode toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-indigo-200 text-xs font-medium">
                    <button
                      onClick={() => setAddMode("url")}
                      className={`flex-1 py-1.5 transition-colors ${addMode === "url" ? "bg-indigo-600 text-white" : "bg-white text-indigo-600 hover:bg-indigo-50"}`}
                    >
                      Paste Teams link
                    </button>
                    <button
                      onClick={() => setAddMode("manual")}
                      className={`flex-1 py-1.5 transition-colors ${addMode === "manual" ? "bg-indigo-600 text-white" : "bg-white text-indigo-600 hover:bg-indigo-50"}`}
                    >
                      Enter IDs manually
                    </button>
                  </div>

                  {addMode === "url" ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Paste Teams channel link…"
                          value={addUrl}
                          onChange={(e) => setAddUrl(e.target.value)}
                          className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 bg-white pr-7"
                        />
                        {urlParsed && (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500 text-sm">✓</span>
                        )}
                      </div>
                      {urlParsed && (
                        <p className="text-xs text-emerald-600 px-1">
                          ✓ Team + channel detected — just add a name below
                        </p>
                      )}
                      {addUrl.trim() && !urlParsed && (
                        <p className="text-xs text-amber-600 px-1">
                          Paste the link from Teams: open the channel → … menu → Get link to channel
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Team ID (groupId)"
                        value={addTeamId}
                        onChange={(e) => setAddTeamId(e.target.value)}
                        className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-indigo-400 bg-white"
                      />
                      <input
                        type="text"
                        placeholder="Channel ID (19:...@thread.tacv2)"
                        value={addChannelId}
                        onChange={(e) => setAddChannelId(e.target.value)}
                        className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-indigo-400 bg-white"
                      />
                    </div>
                  )}

                  <input
                    type="text"
                    placeholder="Label, e.g. Techniline › Daily Scrum"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 bg-white"
                  />

                  {addError && <p className="text-xs text-red-600">{addError}</p>}

                  <div className="flex gap-2">
                    <button
                      onClick={handleAdd}
                      disabled={adding || !addName.trim() || !(addTeamId && addChannelId)}
                      className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {adding ? "Saving…" : "Save channel"}
                    </button>
                    <button
                      onClick={() => { setShowAdd(false); setAddUrl(""); setAddName(""); setAddTeamId(""); setAddChannelId(""); setAddError(null); }}
                      className="px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAdd(true)}
                  className="w-full py-2 rounded-xl border border-dashed border-indigo-300 text-sm text-indigo-600 font-medium hover:bg-indigo-50 transition-colors"
                >
                  + Add channel
                </button>
              )}

              {sendError && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3">
                  <p className="text-xs text-red-700">⚠️ {sendError}</p>
                  {sendError.includes("ChannelMessage.Send") && (
                    <p className="text-xs text-red-500 mt-1">
                      Add <code>ChannelMessage.Send</code> as an <b>application</b> permission to your Azure app registration and grant admin consent.
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={!selected || sending}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  !selected || sending
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow hover:shadow-md"
                }`}
              >
                {sending ? "Sending…" : selected ? `Post to ${selected.name}` : "Select a channel above"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ManagerOverview({ date }: { date: string }) {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<Record<string, StandupLog>>({});
  const [prevLogs, setPrevLogs] = useState<Record<string, StandupLog | null>>({});
  const [vihanLog, setVihanLog] = useState<StandupLog | null>(null);
  const [vihanPrevLog, setVihanPrevLog] = useState<StandupLog | null>(null);
  const [vihanTomorrowLog, setVihanTomorrowLog] = useState<StandupLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [meetingCopied, setMeetingCopied] = useState(false);
  const [showTeamsModal, setShowTeamsModal] = useState(false);
  const [teamsToken, setTeamsToken] = useState("");

  useEffect(() => {
    if (!profile) return;
    setLoading(true);
    Promise.all([
      fetchStandupsByDate(date),
      fetchStandupLog(profile.id, date),
      fetchStandupLog(profile.id, nextDay(date)),
      // prev-day logs to backfill yesterday items
      fetchPrevLog(AARON_ID, date),
      fetchPrevLog(MARICEL_ID, date),
      fetchPrevLog(profile.id, date),
    ])
      .then(([rows, myLog, myTomorrowLog, aaronPrev, maricelPrev, vihanPrev]) => {
        const map: Record<string, StandupLog> = {};
        for (const row of rows) map[row.user_id] = row;
        setLogs(map);
        setVihanLog(myLog);
        setVihanTomorrowLog(myTomorrowLog);
        setPrevLogs({ [AARON_ID]: aaronPrev, [MARICEL_ID]: maricelPrev });
        setVihanPrevLog(vihanPrev);
      })
      .finally(() => setLoading(false));
  }, [date, profile]);

  // Grab Supabase session token for authenticated API calls
  useEffect(() => {
    import("@/lib/supabaseClient").then(({ supabase }) => {
      supabase.auth.getSession().then(({ data }) => {
        setTeamsToken(data.session?.access_token ?? "");
      });
    });
  }, [profile]);

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

  const hasAny = users.some((u) => logs[u.id]) || !!vihanLog;

  /** If a log has no yesterday_items, backfill from the previous day's today_items. */
  function withYesterday(log: StandupLog | null, userId: string, prev: StandupLog | null): StandupLog {
    const base: StandupLog = log ?? {
      id: "", user_id: userId, log_date: date,
      yesterday_items: [], today_items: [], blocker_items: [],
      created_at: "", updated_at: "",
    };
    if (base.yesterday_items.some((i) => i.text)) return base;
    // Backfill from prev day's today list
    const backfill = (prev?.today_items ?? []).filter((i) => i.text);
    return { ...base, yesterday_items: backfill };
  }

  function buildAllEntries() {
    const teamEntries = users.map((u) => ({
      log: withYesterday(logs[u.id] ?? null, u.id, prevLogs[u.id] ?? null),
      name: u.name,
    }));
    const vihanEntry = {
      log: withYesterday(vihanLog, profile?.id ?? "", vihanPrevLog),
      name: "Vihan",
    };
    const entries: { log: StandupLog; name: string }[] = [...teamEntries, vihanEntry];
    if (vihanTomorrowLog && vihanTomorrowLog.today_items.some((i) => i.text)) {
      entries.push({ log: vihanTomorrowLog, name: "Vihan (Tomorrow)" });
    }
    return entries;
  }

  async function copyMeetingSummary() {
    const text = buildMeetingSummary(buildAllEntries());
    try {
      await navigator.clipboard.writeText(text);
      setMeetingCopied(true);
      setTimeout(() => setMeetingCopied(false), 2500);
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      {/* KPI snapshot bar + meeting export */}
      <div className="grid grid-cols-3 gap-4">
        {[
          ...users.map((u) => ({ id: u.id, name: u.name, color: u.color, log: logs[u.id] ?? null })),
          { id: profile?.id ?? "", name: "Vihan", color: "emerald", log: vihanLog },
        ].map((u) => {
          const colorMap: Record<string, string> = {
            blue:    "from-blue-500 to-indigo-600",
            violet:  "from-violet-500 to-purple-600",
            emerald: "from-emerald-500 to-teal-600",
          };
          return (
            <div key={u.id} className={`rounded-xl bg-gradient-to-br ${colorMap[u.color] ?? "from-gray-500 to-gray-700"} p-0.5 shadow`}>
              <div className="rounded-xl bg-white/95 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-900">{u.name}</p>
                  <p className="text-xs text-gray-500">
                    {u.log
                      ? `${u.log.today_items.filter((i) => i.text).length} today · ${u.log.blocker_items.filter((i) => i.text).length} blockers`
                      : "No log submitted"}
                  </p>
                </div>
                <div className={`w-2.5 h-2.5 rounded-full ${u.log ? "bg-emerald-400" : "bg-gray-300"}`} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Meeting export card */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-0.5 shadow-lg">
        <div className="rounded-2xl bg-white/97 px-5 py-4 space-y-3">
          <div>
            <p className="font-bold text-gray-900">📤 Share in Meeting</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Combined standup for Aaron, Maricel and Vihan.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={copyMeetingSummary}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow ${
                meetingCopied
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-900 text-white hover:bg-gray-700"
              }`}
            >
              {meetingCopied ? "✓ Copied!" : "📋 Copy for WhatsApp"}
            </button>
            <button
              onClick={() => setShowTeamsModal(true)}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow hover:shadow-md transition-all"
            >
              🟣 Post to Teams channel
            </button>
          </div>
        </div>
      </div>

      {/* Teams channel picker modal */}
      {showTeamsModal && (
        <TeamsShareModal
          summaryText={buildMeetingSummary(buildAllEntries())}
          token={teamsToken}
          onClose={() => setShowTeamsModal(false)}
        />
      )}

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
  const [managerTab, setManagerTab] = useState<"my-log" | "team">("team");
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
            <h1 className="text-2xl font-bold text-gray-900">Daily Standup</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {manager ? "Log your standup or view the team" : "Log your yesterday, today, and blockers"}
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
            max={manager ? undefined : today}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm font-medium text-gray-800 outline-none bg-transparent"
          />
          <button
            onClick={() => { if (manager || !isToday) setDate(nextDay(date)); }}
            disabled={!manager && isToday}
            className="text-gray-400 hover:text-gray-700 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ›
          </button>
          {date !== today && (
            <button
              onClick={() => setDate(today)}
              className="text-xs text-blue-600 font-medium hover:underline ml-1"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Manager tab switcher */}
      {manager && (
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          <button
            onClick={() => setManagerTab("my-log")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              managerTab === "my-log"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            🧑‍💼 My Log
          </button>
          <button
            onClick={() => setManagerTab("team")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              managerTab === "team"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            👥 Team Overview
          </button>
        </div>
      )}

      {/* Content */}
      {manager ? (
        managerTab === "my-log" ? (
          <StandupForm userId={profile.id} date={date} isOwnLog={true} />
        ) : (
          <ManagerOverview date={date} />
        )
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
