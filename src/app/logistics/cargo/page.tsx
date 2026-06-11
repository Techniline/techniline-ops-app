"use client";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { surface } from "@/components/ui";

export default function CargoDeliveriesPage() {
  return (
    <LogisticsShell title="Cargo Deliveries" subtitle="Manual cargo / freight tracking.">
      <div className={`${surface} p-5 text-sm text-slate-500`}>
        Cargo delivery entry and tracking is coming in Phase 3.
      </div>
    </LogisticsShell>
  );
}
