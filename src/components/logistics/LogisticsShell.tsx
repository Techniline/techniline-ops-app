"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { RouteGuard } from "@/components/RouteGuard";
import type { LogisticsPage } from "@/lib/permissions";
import type { Capability } from "@/lib/types";

/**
 * Wraps a Logistics portal page: route-level access control (logistics users
 * and managers only, plus per-page grants), the app chrome and the page header.
 * The categorized Logistics navigation lives in the left sidebar.
 *
 * Pass `altCapability` to allow access for users who hold that capability even
 * if they lack a logistics role (e.g. finance users accessing the Noon page).
 */
export function LogisticsShell({
  title,
  subtitle,
  actions,
  page,
  wide,
  altCapability,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  page?: LogisticsPage;
  wide?: boolean;
  altCapability?: Capability;
  children: ReactNode;
}) {
  return (
    <RouteGuard requireLogistics logisticsPage={page} altCapability={altCapability}>
      <AppShell fullWidth={wide}>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {children}
      </AppShell>
    </RouteGuard>
  );
}
