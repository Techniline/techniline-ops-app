"use client";

import { ComingSoon } from "@/components/logistics/ComingSoon";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";

export default function AmazonVendorPage() {
  return (
    <LogisticsShell title="Amazon Vendor" subtitle="Amazon Vendor Central logistics.">
      <ComingSoon channel="Amazon Vendor" />
    </LogisticsShell>
  );
}
