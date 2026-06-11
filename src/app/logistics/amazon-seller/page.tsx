"use client";

import { ComingSoon } from "@/components/logistics/ComingSoon";
import { LogisticsShell } from "@/components/logistics/LogisticsShell";

export default function AmazonSellerPage() {
  return (
    <LogisticsShell title="Amazon Seller / Flex" subtitle="Amazon Seller & Flex logistics.">
      <ComingSoon channel="Amazon Seller / Flex" />
    </LogisticsShell>
  );
}
