"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import type { LogisticsPage } from "@/lib/permissions";

/**
 * Wraps a Logistics portal page: route-level access control (logistics users
 * and managers only, plus per-page grants), the app chrome and the page header.
 * The categorized Logistics navigation lives in the left sidebar.
 */
export function LogisticsShell({
  title,
  subtitle,
  actions,
  page,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  page?: LogisticsPage;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <RouteGuard requireLogistics logisticsPage={page}>
      <AppShell fullWidth={wide}>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {children}
      </AppShell>
    </RouteGuard>
  );
}
