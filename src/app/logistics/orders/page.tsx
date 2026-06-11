"use client";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { surface } from "@/components/ui";

export default function LogisticsOrdersPage() {
  return (
    <LogisticsShell
      title="Shopify / MusicMajlis Orders"
      subtitle="Sync, track and fulfill MusicMajlis orders."
    >
      <div className={`${surface} p-5 text-sm text-slate-500`}>
        The order list, detail view, packing checklist and Shopify fulfillment push are
        being wired up (Phase 2). The database tables and access control are already in
        place.
      </div>
    </LogisticsShell>
  );
}
