"use client";

import { useState } from "react";
import type { ComponentType, SVGProps } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import {
  canViewChecklist,
  canViewCocoblu,
  canViewFinance,
  isManager,
} from "@/lib/permissions";

import {
  ActionsIcon,
  ChecklistIcon,
  ChevronLeftIcon,
  CocobluIcon,
  DashboardIcon,
  Logo,
  LogoutIcon,
} from "./icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  href: string;
  label: string;
  icon: IconType;
  show: boolean;
  disabled?: boolean;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
}) {
  const { profile, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (!profile) return null;

  const role = isManager(profile) ? "Manager" : "Staff";
  const displayName = profile.full_name ?? profile.email ?? "User";

  // `collapsed` is a desktop-only rail — express it with `lg:` utilities so the
  // mobile drawer always shows full labels.
  const labelHidden = collapsed ? "lg:hidden" : "";

  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: DashboardIcon, show: true },
    {
      href: "/checklist",
      label: "Checklist",
      icon: ChecklistIcon,
      show: canViewChecklist(profile),
    },
    {
      href: "/cocoblu",
      label: "Cocoblu",
      icon: CocobluIcon,
      show: canViewCocoblu(profile),
    },
    {
      href: "/amazon-actions",
      label: "Amazon Actions",
      icon: ActionsIcon,
      show: canViewFinance(profile),
    },
  ];

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace("/login");
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 lg:static lg:z-auto lg:h-screen lg:shadow-none lg:transition-[width] dark:border-slate-800 dark:bg-slate-900 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      } ${collapsed ? "lg:w-[4.75rem]" : "lg:w-64"}`}
    >
      {/* Brand + collapse toggle */}
      <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-4 dark:border-slate-800">
        <div
          className={`flex items-center gap-2.5 ${
            collapsed ? "lg:justify-center" : "justify-between"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo className="shrink-0" />
            <div className={`min-w-0 leading-tight ${labelHidden}`}>
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                Techniline
              </p>
              <p className="truncate text-xs text-slate-500">Operations</p>
            </div>
          </div>
          {/* Inline collapse toggle — desktop, expanded state only */}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse menu"
            className={`h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
              collapsed ? "hidden" : "hidden lg:flex"
            }`}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
        </div>
        {/* Expand toggle — desktop, collapsed state only (own row, no overlap) */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand menu"
          className={`h-7 w-full items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${
            collapsed ? "hidden lg:flex" : "hidden"
          }`}
        >
          <ChevronLeftIcon className="h-4 w-4 rotate-180" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        <p
          className={`px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${labelHidden}`}
        >
          Menu
        </p>
        {navItems
          .filter((item) => item.show)
          .map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  collapsed ? "lg:justify-center" : ""
                } ${
                  active
                    ? "bg-indigo-50 text-indigo-700 shadow-sm dark:bg-indigo-950/60 dark:text-indigo-300"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                }`}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r-full bg-indigo-600 lg:w-1" />
                ) : null}
                <Icon className="h-5 w-5 shrink-0" />
                <span className={labelHidden}>{item.label}</span>
              </Link>
            );
          })}
      </nav>

      {/* User card + sign out */}
      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div
          className={`flex items-center gap-3 rounded-lg px-2 py-2 ${
            collapsed ? "lg:justify-center lg:px-0" : ""
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-xs font-semibold text-white">
            {initialsFrom(displayName)}
          </span>
          <div className={`min-w-0 leading-tight ${labelHidden}`}>
            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {displayName}
            </p>
            <p className="text-xs text-slate-500">{role}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          title={collapsed ? "Sign out" : undefined}
          className={`mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100`}
        >
          <LogoutIcon className="h-4 w-4 shrink-0" />
          <span className={labelHidden}>{signingOut ? "Signing out…" : "Sign out"}</span>
        </button>
      </div>
    </aside>
  );
}
