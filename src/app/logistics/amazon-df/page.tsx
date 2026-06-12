"use client";

import { ComingSoon } from "@/components/logistics/ComingSoon";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";

export default function AmazonDfPage() {
  return (
    <LogisticsShell title="Amazon DF" subtitle="Amazon Direct Fulfillment logistics." page="marketplace">
      <ComingSoon channel="Amazon DF" />
    </LogisticsShell>
  );
}
