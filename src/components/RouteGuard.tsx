"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import {
  canViewLogistics,
  canViewLogisticsPage,
  hasCapability,
  isLogisticsOnly,
  isLpOnly,
  type LogisticsPage,
} from "@/lib/permissions";
import type { Capability } from "@/lib/types";

import { LoadingScreen } from "./LoadingScreen";

interface RouteGuardProps {
  children: ReactNode;
  /**
   * When set, the authenticated user must hold this capability to view the
   * page. Unauthorized users are redirected to the dashboard. Used to protect
   * module routes (Checklist, Cocoblu, Finance) once they exist.
   */
  requireCapability?: Capability;
  /**
   * When true, the page belongs to the Logistics portal. Only logistics-capable
   * users (the dedicated logistics user or a manager) may view it; everyone else
   * is redirected to /dashboard.
   */
  requireLogistics?: boolean;
  /**
   * The specific logistics page being guarded. When set, the user must hold a
   * grant for this page (full-access users always do); otherwise redirected.
   */
  logisticsPage?: LogisticsPage;
  /**
   * Alternative capability that grants access as a substitute for the logistics
   * requirement. A user who holds this capability passes `requireLogistics` and
   * `logisticsPage` checks even without logistics access. Used for cross-portal
   * pages (e.g. Noon is under the logistics Channels section but also reachable
   * by finance users who lack a logistics role).
   */
  altCapability?: Capability;
}

/**
 * Wraps a protected page. Redirects unauthenticated users to /login and,
 * optionally, users lacking a required capability back to /dashboard.
 *
 * Central portal isolation: a dedicated logistics user (role === "logistics",
 * not a manager) is confined to /logistics/* — any other route redirects them
 * to /logistics. This enforces the access rule at the routing layer, not just
 * by hiding sidebar items.
 */
export function RouteGuard({ children, requireCapability, requireLogistics, logisticsPage, altCapability }: RouteGuardProps) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const onLogisticsRoute = pathname?.startsWith("/logistics") ?? false;
  const onLpRoute = pathname?.startsWith("/lp") ?? false;

  // altCapability lets a user bypass requireLogistics/logisticsPage if they hold that capability.
  const hasAlt = !!altCapability && !!profile && hasCapability(profile, altCapability);

  const authorized =
    !!user &&
    !!profile &&
    (!requireCapability || hasCapability(profile, requireCapability)) &&
    (!requireLogistics || canViewLogistics(profile) || hasAlt) &&
    (!logisticsPage || canViewLogisticsPage(profile, logisticsPage) || hasAlt) &&
    // A logistics-only user may never view a non-logistics route.
    (!isLogisticsOnly(profile) || onLogisticsRoute) &&
    // An LP-only user may never view a non-LP route.
    (!isLpOnly(profile) || onLpRoute);

  useEffect(() => {
    if (loading) return;

    if (!user || !profile) {
      router.replace("/login");
      return;
    }

    // Logistics-only users are confined to the Logistics portal.
    if (isLogisticsOnly(profile) && !onLogisticsRoute) {
      router.replace("/logistics");
      return;
    }

    // LP-only users (e.g. Pavithran) are confined to the LP Tracker.
    if (isLpOnly(profile) && !onLpRoute) {
      router.replace("/lp");
      return;
    }

    const hasAltCap = !!altCapability && hasCapability(profile, altCapability);

    if (requireLogistics && !canViewLogistics(profile) && !hasAltCap) {
      router.replace("/dashboard");
      return;
    }

    if (logisticsPage && !canViewLogisticsPage(profile, logisticsPage) && !hasAltCap) {
      router.replace("/dashboard");
      return;
    }

    if (requireCapability && !hasCapability(profile, requireCapability)) {
      router.replace("/dashboard");
    }
  }, [loading, user, profile, requireCapability, requireLogistics, logisticsPage, altCapability, onLogisticsRoute, onLpRoute, router]);

  if (loading) {
    return <LoadingScreen message="Checking your session…" />;
  }

  if (!authorized) {
    // A redirect is in flight; render a neutral screen meanwhile.
    return <LoadingScreen message="Redirecting…" />;
  }

  return <>{children}</>;
}
