"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import { useRouter } from "next/navigation";

import { useAuth } from "@/app/providers/AuthProvider";
import { hasCapability } from "@/lib/permissions";
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
}

/**
 * Wraps a protected page. Redirects unauthenticated users to /login and,
 * optionally, users lacking a required capability back to /dashboard.
 */
export function RouteGuard({ children, requireCapability }: RouteGuardProps) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  const authorized =
    !!user &&
    !!profile &&
    (!requireCapability || hasCapability(profile.id, requireCapability));

  useEffect(() => {
    if (loading) return;

    if (!user || !profile) {
      router.replace("/login");
      return;
    }

    if (requireCapability && !hasCapability(profile.id, requireCapability)) {
      router.replace("/dashboard");
    }
  }, [loading, user, profile, requireCapability, router]);

  if (loading) {
    return <LoadingScreen message="Checking your session…" />;
  }

  if (!authorized) {
    // A redirect is in flight; render a neutral screen meanwhile.
    return <LoadingScreen message="Redirecting…" />;
  }

  return <>{children}</>;
}
