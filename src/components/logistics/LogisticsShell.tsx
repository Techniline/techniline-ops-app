"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";

import { LogisticsNav } from "./LogisticsNav";

/**
 * Wraps a Logistics portal page: route-level access control (logistics users
 * and managers only), the app chrome, the page header and the in-portal nav.
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
        <LogisticsNav />
        {children}
      </AppShell>
    </RouteGuard>
  );
}
