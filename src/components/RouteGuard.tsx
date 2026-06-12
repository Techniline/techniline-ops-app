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
export function RouteGuard({ children, requireCapability, requireLogistics, logisticsPage }: RouteGuardProps) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const onLogisticsRoute = pathname?.startsWith("/logistics") ?? false;

  const authorized =
    !!user &&
    !!profile &&
    (!requireCapability || hasCapability(profile, requireCapability)) &&
    (!requireLogistics || canViewLogistics(profile)) &&
    (!logisticsPage || canViewLogisticsPage(profile, logisticsPage)) &&
    // A logistics-only user may never view a non-logistics route.
    (!isLogisticsOnly(profile) || onLogisticsRoute);

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

    if (requireLogistics && !canViewLogistics(profile)) {
      router.replace("/dashboard");
      return;
    }

    if (logisticsPage && !canViewLogisticsPage(profile, logisticsPage)) {
      router.replace("/dashboard");
      return;
    }

    if (requireCapability && !hasCapability(profile, requireCapability)) {
      router.replace("/dashboard");
    }
  }, [loading, user, profile, requireCapability, requireLogistics, logisticsPage, onLogisticsRoute, router]);

  if (loading) {
    return <LoadingScreen message="Checking your session…" />;
  }

  if (!authorized) {
    // A redirect is in flight; render a neutral screen meanwhile.
    return <LoadingScreen message="Redirecting…" />;
  }

  return <>{children}</>;
}
