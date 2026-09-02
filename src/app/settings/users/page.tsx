"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/lib/supabaseClient";
import { isManager } from "@/lib/permissions";

const SUPERUSER_UID = "c4abda49-13e9-41fd-acae-88acd4aa7fcb";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Role {
  id: string;
  name: string;
  description: string | null;
  capabilities: string[];
  color: string;
  created_at: string;
}

interface UserWithRoles {
  id: string;
  full_name: string | null;
  email: string;
  avatar_initials: string | null;
  role: string | null;
  active: boolean;
  portal_access: string[] | null;
  roles: Role[];
}

// ── Capability display labels ──────────────────────────────────────────────────

const CAP_LABELS: Record<string, string> = {
  checklist: "Checklist",
  finance: "Finance",
  accounts: "Accounts",
  logistics: "Logistics",
  consults: "Consults",
  cocoblu: "Cocoblu",
  lp_tracker: "LP Tracker",
  seller_central: "Seller Central",
  seller_orders: "Seller Orders",
  seller_finance: "Seller Finance",
  stock_reservation: "Stock Reservation",
  stock_reservation_manager: "Stock Mgr",
  noon: "Noon",
  packing_list: "Packing List",
};

const ALL_CAPS = Object.keys(CAP_LABELS);

const CAP_SECTIONS: { heading: string; caps: string[] }[] = [
  { heading: "Operations", caps: ["checklist", "finance", "accounts", "logistics", "consults", "noon", "packing_list"] },
  { heading: "Seller / Amazon", caps: ["seller_central", "seller_orders", "seller_finance", "cocoblu"] },
  { heading: "Stock / LP", caps: ["stock_reservation", "stock_reservation_manager", "lp_tracker"] },
];

const PRESET_COLORS = [
  { value: "#6366f1", label: "Indigo" },
  { value: "#10b981", label: "Emerald" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#ef4444", label: "Red" },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#0ea5e9", label: "Sky" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

async function freshToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ── Role Modal ─────────────────────────────────────────────────────────────────

interface RoleModalProps {
  initial: Partial<Role> | null;
  onClose: () => void;
  onSaved: () => void;
}

function RoleModal({ initial, onClose, onSaved }: RoleModalProps) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? "#6366f1");
  const [caps, setCaps] = useState<Set<string>>(new Set(initial?.capabilities ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCap(cap: string) {
    setCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError(null);
    try {
      const tok = await freshToken();
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        capabilities: [...caps],
        color,
      };

      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/admin/roles/${initial!.id}`, {
          method: "PATCH",
          headers: authHeaders(tok),
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/admin/roles", {
          method: "POST",
          headers: authHeaders(tok),
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Failed to save role."); return; }
      onSaved();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isEdit ? "Edit Role" : "New Role"}
          </h2>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Name <span className="text-red-500">*</span></span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Salesperson"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Description <span className="text-xs text-slate-400">(optional)</span></span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this role"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>

          {/* Color */}
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Color</p>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${color === c.value ? "ring-2 ring-offset-2 ring-slate-400" : ""}`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Capabilities</p>
            <div className="space-y-4">
              {CAP_SECTIONS.map((section) => (
                <div key={section.heading}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{section.heading}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {section.caps.map((cap) => (
                      <label key={cap} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={caps.has(cap)}
                          onChange={() => toggleCap(cap)}
                          className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">{CAP_LABELS[cap] ?? cap}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Role"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Roles Tab ──────────────────────────────────────────────────────────────────

interface RolesTabProps {
  roles: Role[];
  onRefresh: () => void;
}

function RolesTab({ roles, onRefresh }: RolesTabProps) {
  const [modalRole, setModalRole] = useState<Partial<Role> | null | false>(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(role: Role) {
    if (!confirm(`Delete role "${role.name}"? This will remove it from all assigned users.`)) return;
    setDeleting(role.id);
    try {
      const tok = await freshToken();
      const res = await fetch(`/api/admin/roles/${role.id}`, {
        method: "DELETE",
        headers: authHeaders(tok),
        body: JSON.stringify({}),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { alert(data.error ?? "Failed to delete role."); return; }
      onRefresh();
    } catch {
      alert("Network error.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">{roles.length} role{roles.length !== 1 ? "s" : ""} defined</p>
        <button
          onClick={() => setModalRole(null)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Role
        </button>
      </div>

      {roles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400 dark:border-slate-700 dark:bg-slate-900">
          No roles yet. Create your first role to get started.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <div
              key={role.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <p className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">{role.name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setModalRole(role)}
                    title="Edit role"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(role)}
                    disabled={deleting === role.id}
                    title="Delete role"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/20"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {role.description && (
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{role.description}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {role.capabilities.length === 0 ? (
                  <span className="text-xs text-slate-400">No capabilities</span>
                ) : (
                  role.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                    >
                      {CAP_LABELS[cap] ?? cap}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalRole !== false && (
        <RoleModal
          initial={modalRole}
          onClose={() => setModalRole(false)}
          onSaved={() => { setModalRole(false); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Users Tab ──────────────────────────────────────────────────────────────────

interface AssignDropdownProps {
  user: UserWithRoles;
  allRoles: Role[];
  onAssigned: () => void;
}

function AssignDropdown({ user, allRoles, onAssigned }: AssignDropdownProps) {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const assignedIds = new Set(user.roles.map((r) => r.id));
  const unassigned = allRoles.filter((r) => !assignedIds.has(r.id));

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleToggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const estimatedHeight = Math.min(unassigned.length * 40, 280);
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < estimatedHeight + 8
        ? rect.top - estimatedHeight - 4
        : rect.bottom + 4;
      setPos({ top, left: rect.left });
    }
    setOpen((v) => !v);
  }

  async function assign(roleId: string) {
    setAssigning(roleId);
    try {
      const tok = await freshToken();
      const res = await fetch("/api/admin/user-roles", {
        method: "POST",
        headers: authHeaders(tok),
        body: JSON.stringify({ user_id: user.id, role_id: roleId }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { alert(data.error ?? "Failed to assign role."); return; }
      onAssigned();
    } catch {
      alert("Network error.");
    } finally {
      setAssigning(null);
      setOpen(false);
    }
  }

  if (unassigned.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={btnRef}
        onClick={handleToggle}
        title="Assign a role"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:hover:border-indigo-500"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
      </button>
      {open && (
        <div
          className="fixed z-50 min-w-[160px] max-h-[280px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
          style={{ top: pos.top, left: pos.left }}
        >
          {unassigned.map((role) => (
            <button
              key={role.id}
              onClick={() => assign(role.id)}
              disabled={assigning === role.id}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: role.color }} />
              {role.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface UsersTabProps {
  users: UserWithRoles[];
  allRoles: Role[];
  onRefresh: () => void;
}

function UsersTab({ users, allRoles, onRefresh }: UsersTabProps) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [pendingCaps, setPendingCaps] = useState<Set<string>>(new Set());
  const [savingCaps, setSavingCaps] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);

  // Add user
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addUserForm, setAddUserForm] = useState({ email: "", full_name: "", role: "user", uid: "" });
  const [addUserError, setAddUserError] = useState<string | null>(null);
  const [addUserSaving, setAddUserSaving] = useState(false);

  // Edit user profile
  const [editUser, setEditUser] = useState<UserWithRoles | null>(null);
  const [editForm, setEditForm] = useState({ full_name: "", avatar_initials: "", role: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddUserSaving(true); setAddUserError(null);
    try {
      const tok = await freshToken();
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: authHeaders(tok),
        body: JSON.stringify(addUserForm),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setAddUserError(data.error ?? "Failed."); return; }
      setAddUserOpen(false);
      setAddUserForm({ email: "", full_name: "", role: "user", uid: "" });
      onRefresh();
    } catch { setAddUserError("Network error."); }
    finally { setAddUserSaving(false); }
  }

  function openEdit(user: UserWithRoles) {
    setEditUser(user);
    setEditForm({ full_name: user.full_name ?? "", avatar_initials: user.avatar_initials ?? "", role: user.role ?? "user" });
    setEditError(null);
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditSaving(true); setEditError(null);
    try {
      const tok = await freshToken();
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: authHeaders(tok),
        body: JSON.stringify({ id: editUser.id, ...editForm }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setEditError(data.error ?? "Failed."); return; }
      setEditUser(null);
      onRefresh();
    } catch { setEditError("Network error."); }
    finally { setEditSaving(false); }
  }

  async function removeRole(userId: string, roleId: string) {
    const key = `${userId}:${roleId}`;
    setRemoving(key);
    try {
      const tok = await freshToken();
      const res = await fetch("/api/admin/user-roles", {
        method: "DELETE",
        headers: authHeaders(tok),
        body: JSON.stringify({ user_id: userId, role_id: roleId }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { alert(data.error ?? "Failed to remove role."); return; }
      onRefresh();
    } catch {
      alert("Network error.");
    } finally {
      setRemoving(null);
    }
  }

  function openModuleEditor(user: UserWithRoles) {
    setPendingCaps(new Set(user.portal_access ?? []));
    setCapsError(null);
    setExpandedUserId(user.id);
  }

  function closeModuleEditor() {
    setExpandedUserId(null);
    setCapsError(null);
  }

  function toggleCap(cap: string) {
    setPendingCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap); else next.add(cap);
      return next;
    });
  }

  async function saveCaps(userId: string) {
    setSavingCaps(true);
    setCapsError(null);
    try {
      const tok = await freshToken();
      const res = await fetch("/api/admin/user-capabilities", {
        method: "PATCH",
        headers: authHeaders(tok),
        body: JSON.stringify({ user_id: userId, portal_access: [...pendingCaps] }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setCapsError(data.error ?? "Failed to save."); return; }
      closeModuleEditor();
      onRefresh();
    } catch {
      setCapsError("Network error.");
    } finally {
      setSavingCaps(false);
    }
  }

  return (
    <>
      {/* Add user button */}
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => { setAddUserOpen(true); setAddUserError(null); }}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          Add User
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/50">
          <tr>
            <th className="px-4 py-3 text-left">User</th>
            <th className="px-4 py-3 text-left">Roles</th>
            <th className="px-4 py-3 text-left">Modules</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {users.map((user) => {
            const isSuperuser = user.id === SUPERUSER_UID;
            const initials = user.avatar_initials ?? (user.full_name ?? user.email).slice(0, 2).toUpperCase();
            const isExpanded = expandedUserId === user.id;
            const activeCaps = user.portal_access ?? [];

            return (
              <>
                <tr key={user.id} className={`${isExpanded ? "bg-indigo-50/40 dark:bg-indigo-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-800/30"}`}>
                  {/* User column */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-xs font-semibold text-white">
                        {initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                          {user.full_name ?? "—"}
                          {isSuperuser && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                              Superuser
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-400">{user.email}</p>
                      </div>
                      {!isSuperuser && (
                        <button
                          onClick={() => openEdit(user)}
                          title="Edit display name / role"
                          className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 11l6.364-6.364a2 2 0 012.828 2.828L11.828 13.828A2 2 0 0110.414 14H9v-1.414a2 2 0 01.586-1.414z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Roles column */}
                  <td className="px-4 py-3">
                    {isSuperuser ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        All capabilities
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {user.roles.length === 0 ? (
                          <span className="text-xs text-slate-300 dark:text-slate-600">No roles assigned</span>
                        ) : (
                          user.roles.map((role) => {
                            const key = `${user.id}:${role.id}`;
                            return (
                              <span
                                key={role.id}
                                className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-medium text-white"
                                style={{ backgroundColor: role.color }}
                              >
                                {role.name}
                                <button
                                  onClick={() => removeRole(user.id, role.id)}
                                  disabled={removing === key}
                                  title={`Remove ${role.name}`}
                                  className="flex h-4 w-4 items-center justify-center rounded-full bg-black/20 hover:bg-black/40 disabled:opacity-40"
                                >
                                  <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </span>
                            );
                          })
                        )}
                        <AssignDropdown user={user} allRoles={allRoles} onAssigned={onRefresh} />
                      </div>
                    )}
                  </td>

                  {/* Modules column */}
                  <td className="px-4 py-3">
                    {isSuperuser ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">
                          {activeCaps.length === 0 ? "None" : `${activeCaps.length} active`}
                        </span>
                        <button
                          onClick={() => isExpanded ? closeModuleEditor() : openModuleEditor(user)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                            isExpanded
                              ? "border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                              : "border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/40"
                          }`}
                        >
                          {isExpanded ? "Close" : "Edit modules"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>

                {/* Inline module editor */}
                {isExpanded && (
                  <tr key={`${user.id}-modules`} className="bg-indigo-50/40 dark:bg-indigo-950/20">
                    <td colSpan={3} className="px-6 pb-4 pt-2">
                      <div className="space-y-3">
                        {CAP_SECTIONS.map((section) => (
                          <div key={section.heading}>
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section.heading}</p>
                            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                              {section.caps.map((cap) => (
                                <label key={cap} className="flex cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={pendingCaps.has(cap)}
                                    onChange={() => toggleCap(cap)}
                                    className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                                  />
                                  <span className="text-sm text-slate-700 dark:text-slate-300">{CAP_LABELS[cap] ?? cap}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}

                        {capsError && (
                          <p className="text-xs text-rose-600">{capsError}</p>
                        )}

                        <p className="text-[11px] text-slate-400">
                          These take effect immediately. Assigning or removing a role will re-sync modules from that role.
                        </p>

                        <div className="flex gap-2">
                          <button
                            onClick={() => saveCaps(user.id)}
                            disabled={savingCaps}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {savingCaps ? "Saving…" : "Save modules"}
                          </button>
                          <button
                            onClick={closeModuleEditor}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>

      {/* ── Add User Modal ── */}
      {addUserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">Add User</h2>
            <p className="mb-4 text-xs text-slate-500">The user must already exist in Supabase Auth (create them there first). This links them to the portal.</p>
            <form onSubmit={(e) => { void handleAddUser(e); }} className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
                <input
                  type="email" required autoFocus
                  value={addUserForm.email}
                  onChange={(e) => setAddUserForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="name@techniline.org"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Display Name</label>
                <input
                  type="text" required
                  value={addUserForm.full_name}
                  onChange={(e) => setAddUserForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="Full Name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Role</label>
                <select
                  value={addUserForm.role}
                  onChange={(e) => setAddUserForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="logistics">Logistics</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Supabase UID <span className="font-normal normal-case text-slate-400">(optional — paste from Supabase Auth dashboard if email lookup fails)</span>
                </label>
                <input
                  type="text"
                  value={addUserForm.uid}
                  onChange={(e) => setAddUserForm((f) => ({ ...f, uid: e.target.value.trim() }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              {addUserError && <p className="text-xs text-red-600">{addUserError}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setAddUserOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400">Cancel</button>
                <button type="submit" disabled={addUserSaving} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {addUserSaving ? "Adding…" : "Add User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h2 className="mb-1 text-lg font-bold text-slate-900 dark:text-slate-100">Edit User</h2>
            <p className="mb-4 text-xs text-slate-400">{editUser.email}</p>
            <form onSubmit={(e) => { void handleEditSave(e); }} className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Display Name</label>
                <input
                  type="text" required autoFocus
                  value={editForm.full_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Initials (2 chars)</label>
                <input
                  type="text" maxLength={2}
                  value={editForm.avatar_initials}
                  onChange={(e) => setEditForm((f) => ({ ...f, avatar_initials: e.target.value.toUpperCase().slice(0, 2) }))}
                  className="w-20 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="AB"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="logistics">Logistics</option>
                </select>
              </div>
              {editError && <p className="text-xs text-red-600">{editError}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditUser(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400">Cancel</button>
                <button type="submit" disabled={editSaving} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {editSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function UserPermissionsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"roles" | "users">("roles");
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Auth gate — redirect if not manager or superuser
  useEffect(() => {
    if (loading) return;
    if (!user || !profile) { router.replace("/login"); return; }
    if (!isManager(profile) && profile.id !== SUPERUSER_UID) {
      router.replace("/dashboard");
    }
  }, [loading, user, profile, router]);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const tok = await freshToken();
      const headers = authHeaders(tok);

      const [rolesRes, usersRes] = await Promise.all([
        fetch("/api/admin/roles", { headers }),
        fetch("/api/admin/user-roles", { headers }),
      ]);

      const rolesData = await rolesRes.json() as { ok: boolean; roles?: Role[] };
      const usersData = await usersRes.json() as { ok: boolean; users?: UserWithRoles[] };

      if (rolesData.ok) setRoles(rolesData.roles ?? []);
      if (usersData.ok) setUsers(usersData.users ?? []);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && user && profile && (isManager(profile) || profile.id === SUPERUSER_UID)) {
      loadData();
    }
  }, [loading, user, profile, loadData]);

  // Show nothing while checking auth
  if (loading || !profile || (!isManager(profile) && profile.id !== SUPERUSER_UID)) {
    return null;
  }

  return (
    <AppShell>
      <PageHeader
        title="User Permissions"
        subtitle="Manage roles and assign capabilities to users."
      />

      {/* Tabs */}
      <div className="mb-6 w-fit flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {([
          { key: "roles" as const, label: `Roles (${roles.length})` },
          { key: "users" as const, label: `Users (${users.length})` },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-indigo-600 text-white shadow"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {dataLoading ? (
        <div className="flex h-48 items-center justify-center text-slate-400">
          <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <>
          {activeTab === "roles" && (
            <RolesTab roles={roles} onRefresh={loadData} />
          )}
          {activeTab === "users" && (
            <UsersTab users={users} allRoles={roles} onRefresh={loadData} />
          )}
        </>
      )}
    </AppShell>
  );
}
