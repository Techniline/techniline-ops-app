"use client";

import { ComingSoon } from "@/components/logistics/ComingSoon";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";

export default function NoonPage() {
  return (
    <LogisticsShell title="Noon" subtitle="Noon marketplace logistics." page="marketplace">
      <ComingSoon channel="Noon" />
    </LogisticsShell>
  );
}
