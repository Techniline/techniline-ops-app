/**
 * Amazon Seller Central SP-API client (server-only). Separate credentials from
 * the Vendor client — never mixed. LWA-only auth (no AWS SigV4). Requires env:
 *   SELLER_SPAPI_CLIENT_ID, SELLER_SPAPI_CLIENT_SECRET, SELLER_SPAPI_REFRESH_TOKEN
 *   SELLER_SPAPI_MARKETPLACE_IDS (optional; comma-separated; defaults to UAE + KSA)
 * Region: UAE → Europe endpoint. Never import from client components.
 *
 * Granted roles: Finance and Accounting, Amazon Fulfillment, Inventory and
 * Order Tracking, Buyer Communication. We sync Orders + Finance. Returns reports
 * are NOT synced: the seller-fulfilled (MFN) returns report needs the restricted
 * "Direct to Consumer Shipping" role, which Amazon declined (Jun 2026). Returns
 * are captured manually in the Marketplace Returns page instead.
 */
const HOST = "sellingpartnerapi-eu.amazon.com";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

function cfg() {
  return {
    clientId: process.env.SELLER_SPAPI_CLIENT_ID || "",
    clientSecret: process.env.SELLER_SPAPI_CLIENT_SECRET || "",
    refreshToken: process.env.SELLER_SPAPI_REFRESH_TOKEN || "",
    marketplaceId: process.env.SELLER_SPAPI_MARKETPLACE_ID || "A2VIGQ35RCS4UG",
  };
}

export function sellerConfigured(): boolean {
  const c = cfg();
  return Boolean(c.clientId && c.clientSecret && c.refreshToken);
}

/** Marketplaces to sync. UAE only by default — the account is registered there
 *  (KSA returned "merchant not registered"). Override with
 *  SELLER_SPAPI_MARKETPLACE_IDS (comma-separated) if more are added later. */
export function sellerMarketplaceIds(): string[] {
  const raw = process.env.SELLER_SPAPI_MARKETPLACE_IDS || "A2VIGQ35RCS4UG";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : ["A2VIGQ35RCS4UG"];
}

export function sellerMarketplaceId(): string {
  return cfg().marketplaceId;
}

// In-memory access-token cache (LWA tokens last ~1h).
let cached: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const c = cfg();
  if (!c.clientId || !c.clientSecret || !c.refreshToken) {
    throw new Error("Seller SP-API is not configured (missing client id / secret / refresh token).");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: c.refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
  });
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`LWA token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("LWA returned no access token.");
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export async function sellerFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://${HOST}${path}`, {
    ...init,
    headers: { "x-amz-access-token": token, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

async function sellerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await sellerFetch(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`Seller SP-API ${path} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ── Connectivity check ───────────────────────────────────────────────────────

export async function sellerPing(): Promise<{ ok: boolean; detail: string }> {
  try {
    await getAccessToken();
    let reach = "";
    try {
      const res = await sellerFetch(
        "/finances/v0/financialEventGroups?MaxResultsPerPage=1&FinancialEventGroupStartedAfter=" +
          new Date(Date.now() - 7 * 86_400_000).toISOString()
      );
      reach = res.ok ? "Finances API OK" : `SP-API reachable (finances status ${res.status})`;
    } catch {
      reach = "token OK (finances check skipped)";
    }
    return { ok: true, detail: `Authenticated — seller credentials valid. ${reach}.` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Unknown error" };
  }
}

/** Probe which Seller endpoints / reports our granted roles allow.
 *  200 = accessible, 403 = role not granted. Lets a manager confirm the keys
 *  and see exactly what's reachable (e.g. Orders API stays 403 until reviewed). */
export async function sellerProbe(): Promise<{ label: string; status: number | string }[]> {
  const now = new Date();
  const after = new Date(now.getTime() - 7 * 86_400_000);
  const iso = (d: Date) => d.toISOString();
  const checks: { label: string; path: string }[] = [
    { label: "Finances event groups (Finance role)", path: `/finances/v0/financialEventGroups?MaxResultsPerPage=1&FinancialEventGroupStartedAfter=${iso(after)}` },
    { label: "FBA returns report (Fulfillment role)", path: `/reports/2021-06-30/reports?reportTypes=GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA&pageSize=1` },
    { label: "Settlement report (Finance role)", path: `/reports/2021-06-30/reports?reportTypes=GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2&pageSize=1` },
    { label: "Orders API (needs Orders role)", path: `/orders/v0/orders?MarketplaceIds=${sellerMarketplaceId()}&CreatedAfter=${iso(after)}` },
    { label: "Pricing — competitivePricing (v0)", path: `/products/pricing/v0/competitivePricing?MarketplaceId=${sellerMarketplaceId()}&Asins=B081CS6KJY&ItemType=Asin` },
    { label: "Pricing — getPricing own price (v0)", path: `/products/pricing/v0/price?MarketplaceId=${sellerMarketplaceId()}&Asins=B081CS6KJY&ItemType=Asin` },
    { label: "Pricing — item offers / Buy Box (v0)", path: `/products/pricing/v0/items/B081CS6KJY/offers?MarketplaceId=${sellerMarketplaceId()}&ItemCondition=New` },
    { label: "Product Type Definitions (Product Listing role)", path: `/definitions/2020-09-01/productTypes?marketplaceIds=${sellerMarketplaceId()}` },
  ];
  const out: { label: string; status: number | string }[] = [];
  for (const c of checks) {
    try {
      const res = await sellerFetch(c.path);
      out.push({ label: c.label, status: res.status });
    } catch (e) {
      out.push({ label: c.label, status: e instanceof Error ? e.message.slice(0, 40) : "error" });
    }
  }
  return out;
}

// ── Finances API (settlement / financial event groups) ───────────────────────

export interface SellerFinanceGroup {
  groupId: string;
  status: string | null;
  startTime: string | null;
  endTime: string | null;
  fundTransferDate: string | null;
  currency: string | null;
  originalTotal: number | null;
  convertedTotal: number | null;
  raw: unknown;
}

interface RawFinanceGroup {
  FinancialEventGroupId?: string;
  ProcessingStatus?: string;
  FinancialEventGroupStart?: string;
  FinancialEventGroupEnd?: string;
  FundTransferDate?: string;
  OriginalTotal?: { CurrencyAmount?: number; CurrencyCode?: string };
  ConvertedTotal?: { CurrencyAmount?: number };
}

/** List financial event groups (settlement periods) started after a date. */
export async function fetchFinancialEventGroups(startedAfter: string): Promise<SellerFinanceGroup[]> {
  const out: SellerFinanceGroup[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ MaxResultsPerPage: "100", FinancialEventGroupStartedAfter: startedAfter });
    if (nextToken) qs.set("NextToken", nextToken);
    const j = await sellerJson<{
      payload?: { FinancialEventGroupList?: RawFinanceGroup[]; NextToken?: string };
    }>(`/finances/v0/financialEventGroups?${qs}`);
    for (const g of j.payload?.FinancialEventGroupList ?? []) {
      if (!g.FinancialEventGroupId) continue;
      out.push({
        groupId: g.FinancialEventGroupId,
        status: g.ProcessingStatus ?? null,
        startTime: g.FinancialEventGroupStart ?? null,
        endTime: g.FinancialEventGroupEnd ?? null,
        fundTransferDate: g.FundTransferDate ?? null,
        currency: g.OriginalTotal?.CurrencyCode ?? null,
        originalTotal: g.OriginalTotal?.CurrencyAmount ?? null,
        convertedTotal: g.ConvertedTotal?.CurrencyAmount ?? null,
        raw: g,
      });
    }
    nextToken = j.payload?.NextToken;
    pages += 1;
  } while (nextToken && pages < 20);
  return out;
}

// ── Finances API (per-order transaction breakdown) ──────────────────────────

/** Aggregated financials for one order (the "what we actually receive" view). */
export interface OrderFinance {
  amazonOrderId: string;
  currency: string | null;
  postedDate: string | null;
  productCharges: number; // Principal
  shippingCharges: number; // ShippingCharge billed to buyer
  promoDiscount: number; // promotions (negative)
  referralFee: number; // Commission (negative)
  fbaFee: number; // FBA / fulfillment fees (negative)
  otherFees: number; // all other fees (negative)
  feesTotal: number; // referral + fba + other
  taxCollected: number; // tax components Amazon collects/remits
  refundTotal: number; // refund event amounts (negative)
  netProceeds: number; // sum of everything = the deposit for this order
  events: { type: string; postedDate: string | null; amount: number }[]; // per-transaction list (like Seller Central)
  raw: unknown[];
}

type AmtObj = { CurrencyAmount?: number; CurrencyCode?: string } | undefined;
const amt = (a: AmtObj): number => (a && typeof a.CurrencyAmount === "number" ? a.CurrencyAmount : 0);
const isFba = (t: string) => /fba|fulfillment/i.test(t);
const isTaxCharge = (t: string) => /tax/i.test(t);

/** List financial events posted after a date and aggregate them per order.
 *  Walks ShipmentEvent + RefundEvent lists (both carry AmazonOrderId). Fees and
 *  promotions arrive already-signed (negative), so netProceeds = sum of all
 *  components = what Amazon deposits for the order. */
export async function fetchFinancialEvents(postedAfter: string): Promise<OrderFinance[]> {
  const byOrder = new Map<string, OrderFinance>();
  const get = (id: string, currency: string | null, posted: string | null): OrderFinance => {
    let f = byOrder.get(id);
    if (!f) {
      f = { amazonOrderId: id, currency, postedDate: posted, productCharges: 0, shippingCharges: 0, promoDiscount: 0, referralFee: 0, fbaFee: 0, otherFees: 0, feesTotal: 0, taxCollected: 0, refundTotal: 0, netProceeds: 0, events: [], raw: [] };
      byOrder.set(id, f);
    }
    if (!f.currency && currency) f.currency = currency;
    if (!f.postedDate && posted) f.postedDate = posted;
    return f;
  };

  type ChargeT = { ChargeType?: string; ChargeAmount?: AmtObj };
  type FeeT = { FeeType?: string; FeeAmount?: AmtObj };
  type PromoT = { PromotionAmount?: AmtObj };
  type ItemT = { ItemChargeList?: ChargeT[]; ItemFeeList?: FeeT[]; PromotionList?: PromoT[]; ItemChargeAdjustmentList?: ChargeT[]; ItemFeeAdjustmentList?: FeeT[]; PromotionAdjustmentList?: PromoT[] };
  type EventT = { AmazonOrderId?: string; PostedDate?: string; FeeReason?: string; ShipmentItemList?: ItemT[]; ShipmentItemAdjustmentList?: ItemT[]; OrderChargeList?: ChargeT[]; OrderChargeAdjustmentList?: ChargeT[]; ShipmentFeeList?: FeeT[]; ShipmentFeeAdjustmentList?: FeeT[]; OrderFeeList?: FeeT[]; FeeList?: FeeT[] };

  const applyCharges = (f: OrderFinance, charges: ChargeT[] | undefined, refund: boolean) => {
    for (const c of charges ?? []) {
      const v = amt(c.ChargeAmount); const t = c.ChargeType ?? "";
      f.netProceeds += v;
      if (refund) f.refundTotal += v;
      if (t === "Principal") f.productCharges += v;
      else if (/shipping/i.test(t) && !isTaxCharge(t)) f.shippingCharges += v;
      else if (isTaxCharge(t)) f.taxCollected += v;
    }
  };
  const applyFees = (f: OrderFinance, fees: FeeT[] | undefined, refund: boolean) => {
    for (const fe of fees ?? []) {
      const v = amt(fe.FeeAmount); const t = fe.FeeType ?? "";
      f.netProceeds += v; f.feesTotal += v;
      if (refund) f.refundTotal += v;
      if (/commission/i.test(t)) f.referralFee += v;
      else if (isFba(t)) f.fbaFee += v;
      else f.otherFees += v;
    }
  };
  const applyPromos = (f: OrderFinance, promos: PromoT[] | undefined, refund: boolean) => {
    for (const p of promos ?? []) {
      const v = amt(p.PromotionAmount);
      f.netProceeds += v; f.promoDiscount += v;
      if (refund) f.refundTotal += v;
    }
  };
  const processEvent = (e: EventT, typeLabel: string, refund: boolean) => {
    if (!e.AmazonOrderId) return;
    const currency = (e.ShipmentItemList?.[0]?.ItemChargeList?.[0]?.ChargeAmount)?.CurrencyCode ?? null;
    const f = get(e.AmazonOrderId, currency, e.PostedDate ?? null);
    f.raw.push(e);
    const before = f.netProceeds;
    applyCharges(f, e.OrderChargeList, refund);
    applyCharges(f, e.OrderChargeAdjustmentList, refund);
    applyFees(f, e.ShipmentFeeList, refund);
    applyFees(f, e.ShipmentFeeAdjustmentList, refund);
    applyFees(f, e.OrderFeeList, refund);
    applyFees(f, e.FeeList, refund); // ServiceFeeEvent (Easy Ship charges, etc.)
    for (const it of [...(e.ShipmentItemList ?? []), ...(e.ShipmentItemAdjustmentList ?? [])]) {
      applyCharges(f, it.ItemChargeList, refund);
      applyCharges(f, it.ItemChargeAdjustmentList, refund);
      applyFees(f, it.ItemFeeList, refund);
      applyFees(f, it.ItemFeeAdjustmentList, refund);
      applyPromos(f, it.PromotionList, refund);
      applyPromos(f, it.PromotionAdjustmentList, refund);
    }
    const amount = Math.round((f.netProceeds - before) * 100) / 100;
    f.events.push({ type: e.FeeReason ? `${typeLabel} (${e.FeeReason})` : typeLabel, postedDate: e.PostedDate ?? null, amount });
  };

  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ MaxResultsPerPage: "100", PostedAfter: postedAfter });
    if (nextToken) qs.set("NextToken", nextToken);
    const j = await sellerJson<{
      payload?: { FinancialEvents?: {
        ShipmentEventList?: EventT[]; RefundEventList?: EventT[]; ServiceFeeEventList?: EventT[];
        ChargebackEventList?: EventT[]; GuaranteeClaimEventList?: EventT[];
      }; NextToken?: string };
    }>(`/finances/v0/financialEvents?${qs}`);
    const ev = j.payload?.FinancialEvents;
    for (const e of ev?.ShipmentEventList ?? []) processEvent(e, "Order Payment", false);
    for (const e of ev?.RefundEventList ?? []) processEvent(e, "Refund", true);
    for (const e of ev?.ServiceFeeEventList ?? []) processEvent(e, "Service / Easy Ship fee", false);
    for (const e of ev?.ChargebackEventList ?? []) processEvent(e, "Chargeback", true);
    for (const e of ev?.GuaranteeClaimEventList ?? []) processEvent(e, "A-to-z Guarantee", true);
    nextToken = j.payload?.NextToken;
    pages += 1;
    if (nextToken) await new Promise((r) => setTimeout(r, 600)); // throttle (Finances ~0.5 req/s)
  } while (nextToken && pages < 40);

  // Round to fil/cents to avoid float dust.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...byOrder.values()].map((f) => ({
    ...f,
    productCharges: r2(f.productCharges), shippingCharges: r2(f.shippingCharges), promoDiscount: r2(f.promoDiscount),
    referralFee: r2(f.referralFee), fbaFee: r2(f.fbaFee), otherFees: r2(f.otherFees), feesTotal: r2(f.feesTotal),
    taxCollected: r2(f.taxCollected), refundTotal: r2(f.refundTotal), netProceeds: r2(f.netProceeds),
  }));
}

// ── Orders API (order tracking / fulfillment) ───────────────────────────────

export interface SellerOrder {
  amazonOrderId: string;
  purchaseDate: string | null;
  lastUpdateDate: string | null;
  status: string | null;
  fulfillmentChannel: string | null;
  salesChannel: string | null;
  shipServiceLevel: string | null;
  itemsShipped: number | null;
  itemsUnshipped: number | null;
  orderTotal: number | null;
  currency: string | null;
  raw: unknown;
}

interface RawOrder {
  AmazonOrderId?: string;
  PurchaseDate?: string;
  LastUpdateDate?: string;
  OrderStatus?: string;
  FulfillmentChannel?: string;
  SalesChannel?: string;
  ShipmentServiceLevelCategory?: string;
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  OrderTotal?: { Amount?: string; CurrencyCode?: string };
}

/** Pull orders CREATED since `createdAfter`, paged. Querying by created date (vs
 *  last-updated) ensures Pending-payment and older orders aren't missed. Orders
 *  API returns all statuses including Pending. Heavily rate-limited (~1 req/min),
 *  so we cap pages. */
export async function fetchSellerOrders(createdAfter: string): Promise<SellerOrder[]> {
  const out: SellerOrder[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ MarketplaceIds: sellerMarketplaceIds().join(","), CreatedAfter: createdAfter });
    if (nextToken) qs.set("NextToken", nextToken);
    const j = await sellerJson<{ payload?: { Orders?: RawOrder[]; NextToken?: string } }>(`/orders/v0/orders?${qs}`);
    for (const o of j.payload?.Orders ?? []) {
      if (!o.AmazonOrderId) continue;
      out.push({
        amazonOrderId: o.AmazonOrderId,
        purchaseDate: o.PurchaseDate ?? null,
        lastUpdateDate: o.LastUpdateDate ?? null,
        status: o.OrderStatus ?? null,
        fulfillmentChannel: o.FulfillmentChannel ?? null,
        salesChannel: o.SalesChannel ?? null,
        shipServiceLevel: o.ShipmentServiceLevelCategory ?? null,
        itemsShipped: o.NumberOfItemsShipped ?? null,
        itemsUnshipped: o.NumberOfItemsUnshipped ?? null,
        orderTotal: o.OrderTotal?.Amount ? Number(o.OrderTotal.Amount) : null,
        currency: o.OrderTotal?.CurrencyCode ?? null,
        raw: o,
      });
    }
    nextToken = j.payload?.NextToken;
    pages += 1;
  } while (nextToken && pages < 30);
  return out;
}

// ── Order items (invoice line items) ─────────────────────────────────────────

export interface SellerOrderItem {
  orderItemId: string;
  asin: string | null;
  sellerSku: string | null;
  title: string | null;
  quantityOrdered: number | null;
  quantityShipped: number | null;
  itemPrice: number | null;
  itemTax: number | null;
  shippingPrice: number | null;
  shippingTax: number | null;
  promotionDiscount: number | null;
  currency: string | null;
  raw: unknown;
}

interface RawMoney { Amount?: string; CurrencyCode?: string }
interface RawOrderItem {
  OrderItemId?: string;
  ASIN?: string;
  SellerSKU?: string;
  Title?: string;
  QuantityOrdered?: number;
  QuantityShipped?: number;
  ItemPrice?: RawMoney;
  ItemTax?: RawMoney;
  ShippingPrice?: RawMoney;
  ShippingTax?: RawMoney;
  PromotionDiscount?: RawMoney;
}

const money = (m?: RawMoney): number | null => (m?.Amount != null && m.Amount !== "" ? Number(m.Amount) : null);

/** Line items for one order (the invoice contents: SKU, qty, price, VAT).
 *  Paged via NextToken. Uses the Orders role (already granted). */
export async function fetchOrderItems(amazonOrderId: string): Promise<SellerOrderItem[]> {
  const out: SellerOrderItem[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = nextToken ? `?NextToken=${encodeURIComponent(nextToken)}` : "";
    const j = await sellerJson<{ payload?: { OrderItems?: RawOrderItem[]; NextToken?: string } }>(
      `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems${qs}`
    );
    for (const it of j.payload?.OrderItems ?? []) {
      if (!it.OrderItemId) continue;
      out.push({
        orderItemId: it.OrderItemId,
        asin: it.ASIN ?? null,
        sellerSku: it.SellerSKU ?? null,
        title: it.Title ?? null,
        quantityOrdered: it.QuantityOrdered ?? null,
        quantityShipped: it.QuantityShipped ?? null,
        itemPrice: money(it.ItemPrice),
        itemTax: money(it.ItemTax),
        shippingPrice: money(it.ShippingPrice),
        shippingTax: money(it.ShippingTax),
        promotionDiscount: money(it.PromotionDiscount),
        currency: it.ItemPrice?.CurrencyCode ?? null,
        raw: it,
      });
    }
    nextToken = j.payload?.NextToken;
    pages += 1;
  } while (nextToken && pages < 10);
  return out;
}

// ── Product Pricing API (own price + Buy Box per SKU) ───────────────────────

export interface SkuPricing {
  sellerSku: string;
  asin: string | null;
  currency: string | null;
  myPrice: number | null; // our current listing price
  buyboxPrice: number | null; // featured (Buy Box) landed price
  lowestPrice: number | null; // lowest landed price on the listing
  isBuyboxWinner: boolean | null; // are we the Buy Box winner?
  offerCount: number | null;
  raw: unknown;
}

type PriceMoney = { Amount?: string | number; CurrencyCode?: string } | undefined;
const pm = (m: PriceMoney): number | null => (m?.Amount != null && m.Amount !== "" ? Number(m.Amount) : null);

/**
 * Pricing for a set of SKUs: our own price via getPricing (batched 20), plus the
 * Buy Box / lowest offer via getItemOffers per ASIN (throttled + capped per run;
 * backfills across runs like order items). Uses the Pricing role.
 */
export interface PriorPricing { buyboxPrice: number | null; lowestPrice: number | null; isBuyboxWinner: boolean | null; offerCount: number | null; asin: string | null }

export async function fetchSkuPricing(
  skus: string[],
  opts?: { offersCap?: number; asinBySku?: Map<string, string>; prior?: Map<string, PriorPricing> }
): Promise<SkuPricing[]> {
  const mp = sellerMarketplaceId();
  const out = new Map<string, SkuPricing>();
  // Seed prior Buy Box so a capped run carries forward already-fetched values
  // (and spends this run's cap on SKUs that still need it).
  const seedBB = (sku: string) => opts?.prior?.get(sku);

  // 1) Own price + ASIN — getPricing, up to 20 SKUs per call. SP-API wants the
  //    Skus list COMMA-SEPARATED (repeated params return only one item).
  for (let i = 0; i < skus.length; i += 20) {
    const batch = skus.slice(i, i + 20);
    const skusParam = batch.map((s) => encodeURIComponent(s)).join(",");
    try {
      const j = await sellerJson<{
        payload?: Array<{
          status?: string; SellerSKU?: string; ASIN?: string;
          Product?: {
            Identifiers?: { MarketplaceASIN?: { ASIN?: string } };
            Offers?: Array<{ BuyingPrice?: { ListingPrice?: PriceMoney; LandedPrice?: PriceMoney }; RegularPrice?: PriceMoney }>;
          };
        }>;
      }>(`/products/pricing/v0/price?MarketplaceId=${mp}&ItemType=Sku&Skus=${skusParam}`);
      for (const it of j.payload ?? []) {
        const sku = it.SellerSKU; if (!sku) continue;
        const off = it.Product?.Offers?.[0];
        const price = pm(off?.BuyingPrice?.ListingPrice) ?? pm(off?.BuyingPrice?.LandedPrice) ?? pm(off?.RegularPrice);
        const pr = seedBB(sku);
        const asin = it.ASIN ?? it.Product?.Identifiers?.MarketplaceASIN?.ASIN ?? opts?.asinBySku?.get(sku) ?? pr?.asin ?? null;
        out.set(sku, {
          sellerSku: sku, asin,
          currency: off?.BuyingPrice?.ListingPrice?.CurrencyCode ?? null,
          myPrice: price,
          buyboxPrice: pr?.buyboxPrice ?? null, lowestPrice: pr?.lowestPrice ?? null,
          isBuyboxWinner: pr?.isBuyboxWinner ?? null, offerCount: pr?.offerCount ?? null, raw: it,
        });
      }
    } catch { /* skip batch on error */ }
    await new Promise((r) => setTimeout(r, 600));
  }

  // 1b) Ensure every requested SKU has a row (even if getPricing returned nothing
  //     for it) so Buy Box can still run from the known ASIN.
  for (const sku of skus) {
    if (out.has(sku)) continue;
    const pr = seedBB(sku);
    const asin = opts?.asinBySku?.get(sku) ?? pr?.asin ?? null;
    out.set(sku, { sellerSku: sku, asin, currency: null, myPrice: null, buyboxPrice: pr?.buyboxPrice ?? null, lowestPrice: pr?.lowestPrice ?? null, isBuyboxWinner: pr?.isBuyboxWinner ?? null, offerCount: pr?.offerCount ?? null, raw: null });
  }

  // 2) Buy Box / lowest — getItemOffers per ASIN. Skip SKUs that already have a
  //    Buy Box (carried forward) so each capped run backfills NEW ones.
  const cap = opts?.offersCap ?? 220;
  let done = 0;
  for (const p of out.values()) {
    if (!p.asin) p.asin = opts?.asinBySku?.get(p.sellerSku) ?? null;
    if (p.buyboxPrice != null) continue; // already have it — don't spend the cap
    if (done >= cap || !p.asin) continue;
    try {
      const j = await sellerJson<{
        payload?: {
          Summary?: {
            BuyBoxPrices?: Array<{ LandedPrice?: PriceMoney; ListingPrice?: PriceMoney }>;
            LowestPrices?: Array<{ LandedPrice?: PriceMoney; ListingPrice?: PriceMoney }>;
            TotalOfferCount?: number;
          };
          Offers?: Array<{ MyOffer?: boolean; IsBuyBoxWinner?: boolean }>;
        };
      }>(`/products/pricing/v0/items/${encodeURIComponent(p.asin)}/offers?MarketplaceId=${mp}&ItemCondition=New`);
      const sum = j.payload?.Summary;
      p.buyboxPrice = pm(sum?.BuyBoxPrices?.[0]?.LandedPrice) ?? pm(sum?.BuyBoxPrices?.[0]?.ListingPrice);
      p.lowestPrice = pm(sum?.LowestPrices?.[0]?.LandedPrice) ?? pm(sum?.LowestPrices?.[0]?.ListingPrice);
      p.offerCount = sum?.TotalOfferCount ?? null;
      p.isBuyboxWinner = (j.payload?.Offers ?? []).some((o) => o.MyOffer && o.IsBuyBoxWinner);
    } catch { /* skip on error */ }
    done += 1;
    await new Promise((r) => setTimeout(r, 1100)); // getItemOffers is heavily rate-limited
  }

  return [...out.values()];
}
