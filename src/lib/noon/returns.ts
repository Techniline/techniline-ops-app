import { noonFbpGet } from "./client";
import type { NoonReturn } from "./types";

interface FbpReturn {
  returnItemNr:   string;
  itemCreatedAt:  string;
  reason:         string;
  subReason?:     string;
  paidPrice:      string;
  returnStatus: {
    code:              string;
    displayName:       string;
    rejectionReason?:  string | null;
  };
  productDetails: {
    orderNr:   string;
    sku:       string;
    title:     string;
    quantity:  number;
  };
  refundDetails?: {
    refundAmount: string;
    refundedAt:   string;
  } | null;
}

interface FbpList { items: FbpReturn[]; total?: number }

// The FBP returns portal API does not support date filtering — it returns all returns.
export async function fetchNoonReturns(
  _fromDate: string,
  _toDate: string,
): Promise<NoonReturn[]> {
  const all: FbpReturn[] = [];
  let page = 1;

  for (;;) {
    const res = await noonFbpGet<FbpList>(
      "/_vs/mp/mp-aftersales-api-sellerlab/seller_return_item/list",
      { page: String(page), limit: "100" },
    );
    all.push(...(res.items ?? []));
    if ((res.items ?? []).length < 100) break;
    if (page >= 10) break;
    page++;
  }

  return all.map((r) => ({
    return_id:             r.returnItemNr,
    order_nr:              r.productDetails.orderNr,
    return_date:           r.itemCreatedAt.slice(0, 10),
    status:                r.returnStatus.code,
    return_reason:         r.reason,
    return_reason_details: r.subReason || undefined,
    product_title:         r.productDetails.title?.trim() || undefined,
    resolution:
      r.returnStatus.code === "completed" ? "refunded" :
      r.returnStatus.code === "closed"    ? "closed"   :
      r.returnStatus.rejectionReason      ?? undefined,
    items: [{
      sku:           r.productDetails.sku,
      qty:           r.productDetails.quantity,
      return_reason: r.reason,
      item_amount:   parseFloat(r.refundDetails?.refundAmount ?? r.paidPrice) || 0,
    }],
    total_return_amount: parseFloat(r.refundDetails?.refundAmount ?? r.paidPrice) || 0,
  }));
}
