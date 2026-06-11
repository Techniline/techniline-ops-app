"use client";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { surface } from "@/components/ui";

export default function DeliveryReportsPage() {
  return (
    <LogisticsShell
      title="Delivery Reports"
      subtitle="Delay, branch support and courier performance reports."
    >
      <div className={`${surface} p-5 text-sm text-slate-500`}>
        Delay Report, Branch Support Report and Courier Report are coming in Phase 3.
      </div>
    </LogisticsShell>
  );
}
