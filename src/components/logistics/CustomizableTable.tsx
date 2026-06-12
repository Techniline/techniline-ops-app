"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/app/providers/AuthProvider";
import { btnSecondary, tableWrap, tdCell } from "@/components/ui";
import { loadUserView, saveUserView } from "@/lib/logistics/orders";

export interface TableColumn<T> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface SavedView {
  order: string[];
  hidden: string[];
}

/**
 * A table with user-customizable columns: drag headers to reorder, a "Columns ▾"
 * menu to show/hide, sticky header + scroll, and the layout saved per user
 * (localStorage cache + server copy via user_prefs, so it follows the user).
 */
export function CustomizableTable<T extends { id: string }>({
  viewKey,
  columns,
  rows,
  loading,
  emptyText,
  rowClassName,
}: {
  viewKey: string;
  columns: TableColumn<T>[];
  rows: T[];
  loading?: boolean;
  emptyText?: string;
  rowClassName?: (row: T) => string;
}) {
  const { profile } = useAuth();
  const defaultOrder = useMemo(() => columns.map((c) => c.id), [columns]);
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  const [colOrder, setColOrder] = useState<string[]>(defaultOrder);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const dragId = useRef<string | null>(null);
  const lsKey = `${viewKey}.${profile?.id ?? "anon"}`;

  const applyView = useCallback(
    (v: SavedView | null) => {
      if (!v || !Array.isArray(v.order)) return;
      const known = v.order.filter((id) => byId.has(id));
      const missing = defaultOrder.filter((id) => !known.includes(id));
      setColOrder([...known, ...missing]);
      setHidden(new Set((v.hidden ?? []).filter((id) => byId.has(id))));
    },
    [byId, defaultOrder]
  );

  useEffect(() => {
    if (!profile?.id) return;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(lsKey);
        if (raw) applyView(JSON.parse(raw) as SavedView);
      } catch {
        /* ignore */
      }
    }
    void loadUserView<SavedView>(viewKey).then((v) => v && applyView(v));
  }, [profile?.id, lsKey, viewKey, applyView]);

  const persist = useCallback(
    (order: string[], hide: Set<string>) => {
      const payload: SavedView = { order, hidden: [...hide] };
      if (typeof window !== "undefined") window.localStorage.setItem(lsKey, JSON.stringify(payload));
      void saveUserView(viewKey, payload);
    },
    [lsKey, viewKey]
  );

  const visible = useMemo(
    () => colOrder.map((id) => byId.get(id)).filter((c): c is TableColumn<T> => !!c && !hidden.has(c.id)),
    [colOrder, hidden, byId]
  );

  function onDrop(targetId: string) {
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === targetId) return;
    const next = colOrder.filter((id) => id !== src);
    next.splice(next.indexOf(targetId), 0, src);
    setColOrder(next);
    persist(next, hidden);
  }

  function toggle(id: string) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    persist(colOrder, next);
  }

  function reset() {
    setColOrder(defaultOrder);
    setHidden(new Set());
    persist(defaultOrder, new Set());
    setMenu(false);
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} className={btnSecondary}>
            Columns ▾
          </button>
          {menu ? (
            <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <div className="max-h-64 overflow-y-auto">
                {colOrder.map((id) => {
                  const col = byId.get(id);
                  if (!col) return null;
                  return (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggle(id)} className="h-4 w-4" />
                      {col.label}
                    </label>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-100 px-1 pt-2 dark:border-slate-800">
                <button type="button" onClick={reset} className="text-xs text-slate-500 hover:underline">
                  Reset
                </button>
                <span className="text-[11px] text-slate-400">Saved automatically</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${tableWrap} max-h-[70vh] overflow-auto`}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {visible.map((col) => (
                <th
                  key={col.id}
                  draggable
                  onDragStart={() => (dragId.current = col.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(col.id)}
                  className="cursor-grab select-none whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800"
                  title="Drag to reorder"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={tdCell} colSpan={visible.length || 1}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className={tdCell} colSpan={visible.length || 1}>
                  {emptyText ?? "No records."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={rowClassName?.(row) ?? "hover:bg-slate-50 dark:hover:bg-slate-800/40"}>
                  {visible.map((col) => (
                    <td key={col.id} className={`${tdCell} whitespace-nowrap ${col.className ?? ""}`}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
