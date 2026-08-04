import { noonExport, parseCsv } from "./client";
import type { NoonStatement, NoonStatementLine } from "./types";

// Exact column names from the Noon finance export (note: "Fullfilment" is Noon's typo)
const F = {
  refNr:       "Reference Nr",
  orderNr:     "Order Nr",
  orderDate:   "Order Date",
  txnDate:     "Transaction Date",
  title:       "Title",
  skus:        "SKUs",
  txnType:     "Transaction Type",
  netProceeds: "Net Proceeds",
  referralFee: "Referral Fee including VAT",
  fulfillFee:  "Fullfilment & Logistics Fees including VAT",
  total:       "Total",
};

function n(s: string | undefined): number {
  return parseFloat(s ?? "") || 0;
}

export async function fetchNoonStatements(fromDate: string, toDate: string): Promise<NoonStatement[]> {
  const csv = await noonExport(
    "noon_financeweb_transactionviewreportonitemlevel",
    { from_date: fromDate, to_date: toDate },
  );
  const rows = parseCsv(csv);

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const k = row[F.refNr];
    if (!k) continue;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(row);
  }

  return Array.from(grouped.entries()).map(([refNr, txns]) => {
    const orderDates = txns.map((t) => t[F.orderDate]).filter(Boolean).sort();
    const txnDates   = txns.map((t) => t[F.txnDate]).filter(Boolean).sort();

    const grossSales = txns.reduce((s, t) => s + n(t[F.netProceeds]), 0);
    const totalFees  = txns.reduce((s, t) => s + n(t[F.referralFee]) + n(t[F.fulfillFee]), 0);
    const netTotal   = txns.reduce((s, t) => s + n(t[F.total]), 0);

    const items: NoonStatementLine[] = txns.map((t) => ({
      order_nr:         t[F.orderNr] || undefined,
      transaction_type: t[F.txnType] ?? "",
      description:      t[F.title] ?? "",
      sku:              t[F.skus] || undefined,
      qty:              undefined,
      unit_price:       undefined,
      amount:           n(t[F.total]),
      transaction_date: t[F.txnDate]?.slice(0, 10) ?? "",
    }));

    return {
      statement_id:  refNr,
      payment_date:  txnDates[txnDates.length - 1]?.slice(0, 10) || "",
      period_from:   orderDates[0]?.slice(0, 10) || "",
      period_to:     orderDates[orderDates.length - 1]?.slice(0, 10) || "",
      gross_sales:   grossSales,
      total_fees:    Math.abs(totalFees),
      total_returns: 0,
      net_amount:    netTotal,
      status:        "paid",
      items,
    };
  });
}
