"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { LogisticsShell } from "@/components/logistics/LogisticsShell";
import { OrderDetailView } from "@/components/logistics/OrderDetailView";
import { btnSecondary } from "@/components/ui";

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  return (
    <LogisticsShell
      title="Order"
      subtitle="Order detail, picking & fulfillment."
      page="orders"
      actions={
        <Link href="/logistics/orders" className={btnSecondary}>
          ← All orders
        </Link>
      }
    >
      <OrderDetailView id={id} />
    </LogisticsShell>
  );
}
