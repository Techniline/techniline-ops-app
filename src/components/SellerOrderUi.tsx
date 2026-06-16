import { needsFulfillment, type SellerOrderRow } from "@/lib/spapi/seller";

/** Colored order-status pill: unfulfilled = orange, shipped = green,
 *  cancelled = red, otherwise slate. Shared by the Amazon Seller Central and
 *  the logistics Amazon Fulfillment pages so they stay consistent. */
export function StatusPill({ order }: { order: SellerOrderRow }) {
  const pill = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
  if (needsFulfillment(order)) {
    return <span className={`${pill} bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300`}>Unfulfilled</span>;
  }
  const st = (order.order_status ?? "").toLowerCase();
  const tone =
    st === "shipped"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : st.includes("cancel")
        ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return <span className={`${pill} ${tone}`}>{order.order_status ?? "—"}</span>;
}

const CHIP_TONE: Record<string, { on: string; off: string }> = {
  all: { on: "bg-indigo-600 text-white", off: "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300" },
  Flex: { on: "bg-blue-600 text-white", off: "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300" },
  "Easy Ship": { on: "bg-violet-600 text-white", off: "bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300" },
  "Self Ship": { on: "bg-teal-600 text-white", off: "bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-950 dark:text-teal-300" },
};

/** className for a fulfillment-channel filter chip. */
export function channelChipClass(active: boolean, key: string): string {
  const t = CHIP_TONE[key] ?? CHIP_TONE.all;
  return `rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? t.on : t.off}`;
}
