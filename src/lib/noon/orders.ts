import { noonExport, parseCsv } from "./client";
import type { NoonOrder } from "./types";

export async function fetchNoonOrders(fromDate: string, toDate: string): Promise<NoonOrder[]> {
  const csv = await noonExport("noon_noonoms_ordersexport", { from_date: fromDate, to_date: toDate });
  const rows = parseCsv(csv);

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const k = row.order_nr;
    if (!k) continue;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(row);
  }

  return Array.from(grouped.entries()).map(([orderNr, items]) => {
    const first = items[0];
    return {
      order_nr: orderNr,
      order_date: first.order_placed_at?.replace(/ UTC$/, "").slice(0, 10) ?? "",
      status: first.item_status ?? "unknown",
      payment_type: "",
      channel: first.market_place ?? "",
      customer_zone: first.market_place_country_code ?? "",
      total_amount: 0,
      items: items.map((r) => ({
        sku: r.sku,
        name: r.item_nr,
        qty: 1,
        unit_price: 0,
        sale_price: 0,
        status: r.item_status || undefined,
        awb_nr: r.awb_nr || undefined,
        shipment_nr: r.shipment_nr || undefined,
        is_fbn: r.is_fulfilled_by_noon === "true",
      })),
    };
  });
}
