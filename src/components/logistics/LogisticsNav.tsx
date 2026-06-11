"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  comingSoon?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/logistics", label: "Dashboard" },
  { href: "/logistics/orders", label: "Shopify / MusicMajlis Orders" },
  { href: "/logistics/reseller", label: "Reseller Deliveries" },
  { href: "/logistics/cargo", label: "Cargo Deliveries" },
  { href: "/logistics/prt", label: "Product Transfers (PRT)" },
  { href: "/logistics/reports", label: "Delivery Reports" },
  { href: "/logistics/amazon-vendor", label: "Amazon Vendor", comingSoon: true },
  { href: "/logistics/amazon-df", label: "Amazon DF", comingSoon: true },
  { href: "/logistics/amazon-seller", label: "Amazon Seller / Flex", comingSoon: true },
  { href: "/logistics/noon", label: "Noon", comingSoon: true },
];

export function LogisticsNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {ITEMS.map((item) => {
        const active =
          item.href === "/logistics"
            ? pathname === "/logistics"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {item.label}
            {item.comingSoon ? (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                Soon
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
