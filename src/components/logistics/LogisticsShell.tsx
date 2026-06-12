"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";

/**
 * Wraps a Logistics portal page: route-level access control (logistics users
 * and managers only), the app chrome and the page header. The categorized
 * Logistics navigation lives in the left sidebar.
 */
export function LogisticsShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RouteGuard requireLogistics>
      <AppShell>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {children}
      </AppShell>
    </RouteGuard>
  );
}
