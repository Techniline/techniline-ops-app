/**
 * Amazon Seller Central SP-API client (server-only). Separate credentials from
 * the Vendor client — never mixed. LWA-only auth (no AWS SigV4). Requires env:
 *   SELLER_SPAPI_CLIENT_ID, SELLER_SPAPI_CLIENT_SECRET, SELLER_SPAPI_REFRESH_TOKEN
 *   SELLER_SPAPI_MARKETPLACE_IDS (optional; comma-separated; defaults to UAE + KSA)
 * Region: UAE → Europe endpoint. Never import from client components.
 *
 * Granted roles: Finance and Accounting + Amazon Fulfillment. The Orders API
 * (per-order tracking) needs the restricted "Inventory and Order Tracking" role
 * via Amazon app review — calls that need it will return 403 until then.
 */
import { gunzipSync } from "node:zlib";

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

/** Pull orders updated since `lastUpdatedAfter` (catches status changes), paged.
 *  The Orders API is heavily rate-limited (~1 req/min), so we cap pages. */
export async function fetchSellerOrders(lastUpdatedAfter: string): Promise<SellerOrder[]> {
  const out: SellerOrder[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ MarketplaceIds: sellerMarketplaceIds().join(","), LastUpdatedAfter: lastUpdatedAfter });
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

// ── Reports API (create → poll → download) ───────────────────────────────────

interface ReportDoc {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string;
}

async function createReport(reportType: string, opts?: { dataStartTime?: string; dataEndTime?: string }): Promise<string> {
  const j = await sellerJson<{ reportId: string }>("/reports/2021-06-30/reports", {
    method: "POST",
    body: JSON.stringify({
      reportType,
      marketplaceIds: sellerMarketplaceIds(),
      ...(opts?.dataStartTime ? { dataStartTime: opts.dataStartTime } : {}),
      ...(opts?.dataEndTime ? { dataEndTime: opts.dataEndTime } : {}),
    }),
  });
  return j.reportId;
}

/** Create a report, poll until done (bounded), and return its raw text (TSV). */
export async function fetchReport(
  reportType: string,
  opts?: { dataStartTime?: string; dataEndTime?: string; maxWaitMs?: number }
): Promise<string> {
  const reportId = await createReport(reportType, opts);
  const deadline = Date.now() + (opts?.maxWaitMs ?? 90_000);
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const r = await sellerJson<{ processingStatus: string; reportDocumentId?: string }>(
      `/reports/2021-06-30/reports/${reportId}`
    );
    if (r.processingStatus === "DONE" && r.reportDocumentId) {
      const doc = await sellerJson<ReportDoc>(`/reports/2021-06-30/documents/${r.reportDocumentId}`);
      const res = await fetch(doc.url);
      if (!res.ok) throw new Error(`Report document download ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return doc.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    }
    if (r.processingStatus === "CANCELLED" || r.processingStatus === "FATAL") {
      throw new Error(`Report ${reportType} ${r.processingStatus}`);
    }
    await new Promise((res) => setTimeout(res, Math.min(2000 + attempt * 1000, 8000)));
  }
  throw new Error(`Report ${reportType} timed out`);
}

/** Parse a tab-separated SP-API report into row objects keyed by header. */
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

export interface SellerReturn {
  source: "fba" | "mfn";
  orderId: string | null;
  sku: string | null;
  asin: string | null;
  returnDate: string | null;
  quantity: number | null;
  reason: string | null;
  status: string | null;
  fulfillmentCenter: string | null;
  detailedDisposition: string | null;
  raw: Record<string, string>;
}

/** Case/format-tolerant lookup across candidate header names in a TSV row. */
function field(row: Record<string, string>, ...names: string[]): string | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase().trim()] = v;
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v != null && v !== "") return v;
  }
  return null;
}
function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** FBA customer returns report → typed rows
 *  (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA). */
export async function fetchFbaCustomerReturns(dataStartTime: string): Promise<SellerReturn[]> {
  const text = await fetchReport("GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA", { dataStartTime, maxWaitMs: 100_000 });
  return parseTsv(text).map((r) => ({
    source: "fba" as const,
    orderId: r["order-id"] || r["amazon-order-id"] || null,
    sku: r["sku"] || r["seller-sku"] || null,
    asin: r["asin"] || null,
    returnDate: r["return-date"] || null,
    quantity: r["quantity"] ? Number(r["quantity"]) : null,
    reason: r["reason"] || null,
    status: r["status"] || null,
    fulfillmentCenter: r["fulfillment-center-id"] || null,
    detailedDisposition: r["detailed-disposition"] || null,
    raw: r,
  }));
}

/** Seller-fulfilled (MFN) returns report → typed rows. This is the data behind
 *  Seller Central's Manage Returns list (GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE).
 *  Header names vary, so we match tolerantly. */
export async function fetchMfnReturns(dataStartTime: string): Promise<SellerReturn[]> {
  const text = await fetchReport("GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE", { dataStartTime, maxWaitMs: 100_000 });
  return parseTsv(text).map((r) => ({
    source: "mfn" as const,
    orderId: field(r, "order-id", "order id", "amazon-order-id", "amazon order id"),
    sku: field(r, "merchant-sku", "merchant sku", "sku", "seller-sku"),
    asin: field(r, "asin"),
    returnDate: field(r, "return-request-date", "return request date", "return-date", "return date"),
    quantity: numOrNull(field(r, "return-quantity", "return quantity", "quantity")),
    reason: field(r, "return-reason", "return reason", "reason"),
    status: field(r, "return-request-status", "return request status", "status", "resolution"),
    fulfillmentCenter: null,
    detailedDisposition: field(r, "resolution", "detailed-disposition", "label-type", "label type"),
    raw: r,
  }));
}
