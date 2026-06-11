"use client";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { surface } from "@/components/ui";

export default function ResellerDeliveriesPage() {
  return (
    <LogisticsShell
      title="Reseller Deliveries"
      subtitle="Manual reseller delivery tracking."
    >
      <div className={`${surface} p-5 text-sm text-slate-500`}>
        Reseller delivery entry and tracking is coming in Phase 3.
      </div>
    </LogisticsShell>
  );
}
