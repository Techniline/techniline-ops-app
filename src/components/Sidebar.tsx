"use client";

import { useState } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import {
  canViewChecklist,
  canViewCocoblu,
  canViewFinance,
  isManager,
} from "@/lib/permissions";

interface NavItem {
  href: string;
  label: string;
  show: boolean;
  /** Disabled items are visible but not navigable (e.g. Finance — Coming Soon). */
  disabled?: boolean;
}

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (!profile) return null;

  const userId = profile.id;
  const role = isManager(userId) ? "Manager" : "Staff";

  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/checklist", label: "Checklist", show: canViewChecklist(userId) },
    { href: "/cocoblu", label: "Cocoblu", show: canViewCocoblu(userId) },
    {
      href: "/finance",
      label: "Finance",
      show: canViewFinance(userId),
      disabled: true,
    },
  ];

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-6">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {profile.full_name ?? profile.email ?? "User"}
        </p>
        <span className="mt-1 inline-block rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {role}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {navItems
          .filter((item) => item.show)
          .map((item) => {
            if (item.disabled) {
              return (
                <span
                  key={item.href}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-gray-400 dark:text-gray-600"
                  aria-disabled="true"
                >
                  {item.label}
                  <span className="text-[10px] uppercase tracking-wide">
                    Soon
                  </span>
                </span>
              );
            }

            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
      </nav>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="mt-4 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </aside>
  );
}
