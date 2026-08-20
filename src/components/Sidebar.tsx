"use client";

import { useEffect, useState } from "react";
import type { ComponentType, SVGProps } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import {
  canViewChecklist,
  canViewCocoblu,
  canViewConsults,
  canViewFinance,
  canViewLogistics,
  canViewLogisticsPage,
  canViewLpTracker,
  canViewSellerCentral,
  canViewSellerOrders,
  canViewSellerFinance,
  canViewAccounts,
  canViewStockReservation,
  canManageStockReservation,
  isLogisticsOnly,
  isLpOnly,
  isManager,
  type LogisticsPage,
} from "@/lib/permissions";

import {
  ActionsIcon,
  AiIcon,
  AnalyticsIcon,
  BlockerIcon,
  ChecklistIcon,
  ChevronLeftIcon,
  CocobluIcon,
  DashboardIcon,
  Logo,
  LogoutIcon,
  CargoIcon,
  LpTrackerIcon,
  PrioritiesIcon,
  ResellerIcon,
  ReturnsIcon,
  ShopifyIcon,
} from "./icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const SUPERUSER_UID = "c4abda49-13e9-41fd-acae-88acd4aa7fcb";
const LS_KEY = "sidebar-expanded-sections";

interface SectionStyle { text: string; border: string; bg: string; hover: string; }

const SECTION_STYLES: Record<string, SectionStyle> = {
  "Overview":         { text: "text-blue-600",    border: "border-blue-200",    bg: "bg-blue-50",    hover: "hover:bg-blue-100"    },
  "Daily":            { text: "text-emerald-600",  border: "border-emerald-200", bg: "bg-emerald-50", hover: "hover:bg-emerald-100" },
  "Amazon & Finance": { text: "text-amber-600",    border: "border-amber-200",   bg: "bg-amber-50",   hover: "hover:bg-amber-100"   },
  "Inventory":        { text: "text-violet-600",   border: "border-violet-200",  bg: "bg-violet-50",  hover: "hover:bg-violet-100"  },
  "Procurement":      { text: "text-teal-600",     border: "border-teal-200",    bg: "bg-teal-50",    hover: "hover:bg-teal-100"    },
  "Admin":            { text: "text-rose-600",     border: "border-rose-200",    bg: "bg-rose-50",    hover: "hover:bg-rose-100"    },
  "Logistics":        { text: "text-indigo-600",   border: "border-indigo-200",  bg: "bg-indigo-50",  hover: "hover:bg-indigo-100"  },
  "Channels":         { text: "text-sky-600",      border: "border-sky-200",     bg: "bg-sky-50",     hover: "hover:bg-sky-100"     },
  "Deliveries":       { text: "text-cyan-600",     border: "border-cyan-200",    bg: "bg-cyan-50",    hover: "hover:bg-cyan-100"    },
  "Operations":       { text: "text-fuchsia-600",  border: "border-fuchsia-200", bg: "bg-fuchsia-50", hover: "hover:bg-fuchsia-100" },
};

interface NavItem {
  href: string;
  label: string;
  icon: IconType;
  show?: boolean;
  comingSoon?: boolean;
}

interface NavSection {
  heading?: string;
  items: NavItem[];
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
  // Stores which sections are EXPANDED. Default = empty (all collapsed).
  // The active page's section is always auto-expanded on first load.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        setExpandedSections(new Set(JSON.parse(stored) as string[]));
      }
      // else: leave all collapsed — default behaviour
    } catch {
      // ignore
    }
  }, []);

  function toggleSection(heading: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading);
      else next.add(heading);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  if (!profile) return null;

  const role = profile.job_title ?? (isManager(profile) ? "Manager" : "Staff");
  const displayName = profile.full_name ?? profile.email ?? "User";

  // `collapsed` is a desktop-only rail — express it with `lg:` utilities so the
  // mobile drawer always shows full labels.
  const labelHidden = collapsed ? "lg:hidden" : "";

  const logisticsOnly = isLogisticsOnly(profile);
  const lpOnly = isLpOnly(profile);

  const generalSectionsRaw: NavSection[] = [
    {
      heading: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: DashboardIcon, show: true },
        { href: "/analytics", label: "Analytics", icon: AnalyticsIcon, show: isManager(profile) },
        { href: "/scorecard", label: "KPI Scorecard", icon: AnalyticsIcon, show: isManager(profile) || canViewSellerOrders(profile) || canViewSellerFinance(profile) },
        { href: "/ai-usage", label: "AI Usage", icon: AiIcon, show: true },
      ],
    },
    {
      heading: "Daily",
      items: [
        { href: "/checklist", label: "Checklist", icon: ChecklistIcon, show: canViewChecklist(profile) },
        { href: "/consults", label: "Musicmajlis Consult Bookings", icon: ActionsIcon, show: canViewConsults(profile) },
        { href: "/priorities", label: "Priorities", icon: PrioritiesIcon, show: true },
        { href: "/blockers", label: "Blockers", icon: BlockerIcon, show: true },
      ],
    },
    {
      heading: "Amazon & Finance",
      items: [
        { href: "/amazon-actions", label: "Amazon Actions", icon: ActionsIcon, show: canViewFinance(profile) },
        { href: "/amazon-actions/seller", label: "Amazon Seller Central", icon: ShopifyIcon, show: canViewSellerCentral(profile) },
        { href: "/logistics/noon", label: "Noon Orders & Finance", icon: ActionsIcon, show: canViewFinance(profile) && !canViewLogistics(profile) },
        { href: "/returns", label: "Returns & Disputes (Finance)", icon: ReturnsIcon, show: canViewFinance(profile) },
        { href: "/vendor-orders", label: "Vendor POs", icon: ShopifyIcon, show: canViewFinance(profile) },
        { href: "/accounts/remittances", label: "Accounts — Remittances", icon: ReturnsIcon, show: canViewAccounts(profile) },
      ],
    },
    {
      heading: "Inventory",
      items: [
        { href: "/cocoblu", label: "Cocoblu", icon: CocobluIcon, show: canViewCocoblu(profile) },
        { href: "/lp", label: "LP Tracker", icon: LpTrackerIcon, show: canViewLpTracker(profile) },
        { href: "/catalog", label: "ERP Catalog", icon: ShopifyIcon, show: isManager(profile) },
      ],
    },
    {
      heading: "Procurement",
      items: [
        {
          href: canManageStockReservation(profile) ? "/stock-reservation/manager" : "/stock-reservation",
          label: "Stock Reservation",
          icon: CargoIcon,
          show: canViewStockReservation(profile),
        },
        { href: "/packing-list", label: "Packing List", icon: CargoIcon, show: true },
      ],
    },
    {
      heading: "Admin",
      items: [
        {
          href: "/settings/users",
          label: "User Permissions",
          icon: ResellerIcon,
          show: isManager(profile) || profile?.id === SUPERUSER_UID,
        },
      ],
    },
  ];
  const generalSections: NavSection[] = generalSectionsRaw
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show !== false) }))
    .filter((s) => s.items.length > 0);

  const can = (page: LogisticsPage) => canViewLogisticsPage(profile, page);
  const logisticsSectionsRaw: NavSection[] = [
    { heading: "Logistics", items: [{ href: "/logistics", label: "Dashboard", icon: DashboardIcon, show: can("dashboard") }] },
    {
      heading: "Channels",
      items: [
        { href: "/logistics/orders", label: "Shopify / MusicMajlis", icon: ShopifyIcon, show: can("orders") },
        { href: "/logistics/amazon-fulfillment", label: "Amazon (Seller + Flex)", icon: ActionsIcon, show: can("amazon_fulfillment") },
        { href: "/logistics/amazon-pricing", label: "Amazon Profit & Pricing", icon: AnalyticsIcon, show: can("amazon_profit") },
        { href: "/logistics/noon", label: "Noon", icon: ActionsIcon, show: can("noon") },
        { href: "/logistics/returns", label: "Marketplace Returns", icon: ReturnsIcon, show: can("marketplace") },
      ],
    },
    {
      heading: "Deliveries",
      items: [
        { href: "/logistics/reseller", label: "Reseller Logistics", icon: ResellerIcon, show: can("reseller") },
        { href: "/logistics/cargo", label: "Cargo Deliveries", icon: CargoIcon, show: can("cargo") },
      ],
    },
    {
      heading: "Operations",
      items: [
        { href: "/logistics/prt", label: "Product Transfers (PRT)", icon: ActionsIcon, show: can("prt") },
        { href: "/logistics/reports", label: "Delivery Reports", icon: AnalyticsIcon, show: can("reports") },
        { href: "/logistics/masters", label: "Master Data", icon: ResellerIcon, show: can("masters") },
      ],
    },
  ];

  const logisticsSections: NavSection[] = logisticsSectionsRaw
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show !== false) }))
    .filter((s) => s.items.length > 0);

  const sections: NavSection[] = lpOnly
    ? [{ heading: "Inventory", items: generalSections.flatMap((s) => s.items).filter((i) => i.href === "/lp") }]
    : logisticsOnly
    ? logisticsSections
    : [...generalSections, ...(canViewLogistics(profile) ? logisticsSections : [])];

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
        {sections.map((section, si) => {
          const isSectionCollapsed = !collapsed && !!section.heading && !expandedSections.has(section.heading);

          return (
            <div key={section.heading ?? `section-${si}`} className={si > 0 ? "mt-2" : ""}>
              {section.heading ? (
                collapsed ? (
                  // Rail mode: just a thin divider, no heading text
                  si > 0 ? <hr className="mx-3 my-1 border-slate-100 dark:border-slate-800" /> : null
                ) : (
                  // Expanded mode: pill button with chevron
                  (() => {
                    const s = SECTION_STYLES[section.heading] ?? { text: "text-slate-500", border: "border-slate-200", bg: "bg-slate-50", hover: "hover:bg-slate-100" };
                    return (
                      <button
                        type="button"
                        onClick={() => toggleSection(section.heading!)}
                        className={`group mt-2 flex w-full items-center justify-between rounded-full border px-3 py-1.5 transition-colors ${s.border} ${s.bg} ${s.hover}`}
                      >
                        <span className={`text-xs font-bold tracking-wide ${s.text}`}>
                          {section.heading}
                        </span>
                        <svg
                          className={`h-3 w-3 transition-transform duration-200 ${s.text} opacity-70 ${isSectionCollapsed ? "rotate-90" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    );
                  })()
                )
              ) : null}

              {!isSectionCollapsed && section.items.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/logistics"
                    ? pathname === "/logistics"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);

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
                    <span className={`flex-1 ${labelHidden}`}>{item.label}</span>
                    {item.comingSoon ? (
                      <span
                        className={`rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ${labelHidden}`}
                      >
                        Soon
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
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
