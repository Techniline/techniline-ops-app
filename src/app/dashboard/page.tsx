"use client";

import Link from "next/link";

import { useAuth } from "@/app/providers/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { RouteGuard } from "@/components/RouteGuard";
import {
  canViewChecklist,
  canViewCocoblu,
  canViewFinance,
  isManager,
} from "@/lib/permissions";

interface ModuleCard {
  key: string;
  title: string;
  description: string;
  href: string | null;
  show: boolean;
  comingSoon: boolean;
}

function DashboardContent() {
  const { profile } = useAuth();

  // RouteGuard guarantees a profile here, but narrow defensively.
  if (!profile) return null;

  const role = isManager(profile) ? "Manager" : "Staff";

  const cards: ModuleCard[] = [
    {
      key: "checklist",
      title: "Checklist",
      description: "Daily operational checklists.",
      href: "/checklist",
      show: canViewChecklist(profile),
      comingSoon: false,
    },
    {
      key: "cocoblu",
      title: "Cocoblu",
      description: "Cocoblu operations.",
      href: "/cocoblu",
      show: canViewCocoblu(profile),
      comingSoon: false,
    },
    {
      key: "finance",
      title: "Finance",
      description: "Financial overview and reporting.",
      href: null,
      show: canViewFinance(profile),
      comingSoon: true,
    },
  ];

  const visibleCards = cards.filter((card) => card.show);

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Welcome, {profile.full_name ?? profile.email ?? "there"}
        </h1>
        <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {role}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCards.map((card) => {
          const inner = (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  {card.title}
                </h2>
                {card.comingSoon ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    Coming Soon
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-gray-500">{card.description}</p>
            </>
          );

          const baseClass =
            "rounded-lg border border-gray-200 p-5 dark:border-gray-800";

          if (card.href && !card.comingSoon) {
            return (
              <Link
                key={card.key}
                href={card.href}
                className={`${baseClass} transition-colors hover:border-gray-400 hover:bg-gray-50 dark:hover:border-gray-600 dark:hover:bg-gray-900`}
              >
                {inner}
              </Link>
            );
          }

          return (
            <div
              key={card.key}
              className={`${baseClass} opacity-70`}
              aria-disabled="true"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RouteGuard>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </RouteGuard>
  );
}
