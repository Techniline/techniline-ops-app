"use client";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { surface } from "@/components/ui";

export default function PrtRequestsPage() {
  return (
    <LogisticsShell
      title="Product Transfer Requests (PRT)"
      subtitle="Branch-to-branch stock transfer requests."
    >
      <div className={`${surface} p-5 text-sm text-slate-500`}>
        PRT workflow and the PRT email generator are coming in Phase 3.
      </div>
    </LogisticsShell>
  );
}
