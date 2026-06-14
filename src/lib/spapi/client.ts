/**
 * Amazon Selling Partner API client (server-only). LWA-only auth (no AWS SigV4 —
 * SP-API dropped that requirement). Requires env:
 *   SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET, SPAPI_REFRESH_TOKEN, SPAPI_MARKETPLACE_ID
 * Region: UAE → Europe endpoint. Never import from client components.
 */
import { gunzipSync } from "node:zlib";

const HOST = "sellingpartnerapi-eu.amazon.com";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

function cfg() {
  return {
    clientId: process.env.SPAPI_CLIENT_ID || "",
    clientSecret: process.env.SPAPI_CLIENT_SECRET || "",
    refreshToken: process.env.SPAPI_REFRESH_TOKEN || "",
    marketplaceId: process.env.SPAPI_MARKETPLACE_ID || "A2VIGQ35RCS4UG",
  };
}

export function spapiConfigured(): boolean {
  const c = cfg();
  return Boolean(c.clientId && c.clientSecret && c.refreshToken);
}

export function marketplaceId(): string {
  return cfg().marketplaceId;
}

// In-memory access-token cache (LWA tokens last ~1h).
let cached: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const c = cfg();
  if (!c.clientId || !c.clientSecret || !c.refreshToken) {
    throw new Error("SP-API is not configured (missing client id / secret / refresh token).");
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
  if (!res.ok) {
    throw new Error(`LWA token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("LWA returned no access token.");
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

/** Low-level SP-API request. `path` includes the leading slash + query string. */
export async function spFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://${HOST}${path}`, {
    ...init,
    headers: {
      "x-amz-access-token": token,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function spJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await spFetch(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`SP-API ${path} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ── Connectivity check ───────────────────────────────────────────────────────

/** Connectivity test. A successful LWA token exchange already proves the client
 *  id, secret and refresh token are all valid — that's the real signal. We then
 *  touch the Reports API just to confirm SP-API accepts the access token. */
export async function spapiPing(): Promise<{ ok: boolean; detail: string }> {
  try {
    await getAccessToken(); // throws if client id / secret / refresh token are wrong
    let reach = "";
    try {
      // reportTypes is required by this endpoint; any structured response = reachable.
      const res = await spFetch("/reports/2021-06-30/reports?reportTypes=GET_VENDOR_SALES_REPORT&pageSize=1");
      reach = res.ok ? "Reports API OK" : `SP-API reachable (reports status ${res.status})`;
    } catch {
      reach = "token OK (Reports check skipped)";
    }
    return { ok: true, detail: `Authenticated — credentials valid. ${reach}.` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Unknown error" };
  }
}

/** Probe which Vendor endpoints / report types our granted roles actually allow.
 *  Returns the HTTP status for each (200 = accessible, 403 = role not granted). */
export async function spapiProbe(): Promise<{ label: string; status: number | string }[]> {
  const now = new Date();
  const after = new Date(now.getTime() - 7 * 86_400_000);
  const iso = (d: Date) => d.toISOString();
  const rt = (t: string) => `/reports/2021-06-30/reports?reportTypes=${t}&pageSize=1`;
  const checks: { label: string; path: string }[] = [
    { label: "Vendor purchase orders (API)", path: `/vendor/orders/v1/purchaseOrders?limit=1&createdAfter=${iso(after)}&createdBefore=${iso(now)}` },
    { label: "Finances event groups (API)", path: `/finances/v0/financialEventGroups?MaxResultsPerPage=1&FinancialEventGroupStartedAfter=${iso(after)}` },
    { label: "Report GET_VENDOR_SALES_REPORT", path: rt("GET_VENDOR_SALES_REPORT") },
    { label: "Report GET_VENDOR_INVENTORY_REPORT", path: rt("GET_VENDOR_INVENTORY_REPORT") },
    { label: "Report GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT", path: rt("GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT") },
    { label: "Report GET_VENDOR_TRAFFIC_REPORT", path: rt("GET_VENDOR_TRAFFIC_REPORT") },
    { label: "Report GET_VENDOR_FORECASTING_REPORT", path: rt("GET_VENDOR_FORECASTING_REPORT") },
  ];
  const out: { label: string; status: number | string }[] = [];
  for (const c of checks) {
    try {
      const res = await spFetch(c.path);
      out.push({ label: c.label, status: res.status });
    } catch (e) {
      out.push({ label: c.label, status: e instanceof Error ? e.message.slice(0, 40) : "error" });
    }
  }
  return out;
}

// ── Vendor Orders ────────────────────────────────────────────────────────────

export interface VendorPO {
  poNumber: string;
  state: string | null;
  type: string | null;
  poDate: string | null;
  stateChangedAt: string | null;
  sellingParty: string | null;
  shipToParty: string | null;
  itemCount: number;
  raw: unknown;
}

interface RawVendorOrder {
  purchaseOrderNumber?: string;
  purchaseOrderState?: string;
  orderDetails?: {
    purchaseOrderDate?: string;
    purchaseOrderStateChangedDate?: string;
    purchaseOrderType?: string;
    sellingParty?: { partyId?: string };
    shipToParty?: { partyId?: string };
    items?: unknown[];
  };
}

/** Pull Vendor purchase orders created in [createdAfter, createdBefore], paged. */
export async function fetchVendorPurchaseOrders(createdAfter: string, createdBefore: string): Promise<VendorPO[]> {
  const out: VendorPO[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({
      limit: "100",
      createdAfter,
      createdBefore,
      sortOrder: "DESC",
    });
    if (nextToken) qs.set("nextToken", nextToken);
    const res = await spFetch(`/vendor/orders/v1/purchaseOrders?${qs}`);
    const text = await res.text();
    if (!res.ok) throw new Error(`Vendor orders ${res.status}: ${text.slice(0, 250)}`);
    const j = JSON.parse(text) as { payload?: { orders?: RawVendorOrder[]; pagination?: { nextToken?: string } } };
    for (const o of j.payload?.orders ?? []) {
      if (!o.purchaseOrderNumber) continue;
      const d = o.orderDetails ?? {};
      out.push({
        poNumber: o.purchaseOrderNumber,
        state: o.purchaseOrderState ?? null,
        type: d.purchaseOrderType ?? null,
        poDate: d.purchaseOrderDate ?? null,
        stateChangedAt: d.purchaseOrderStateChangedDate ?? null,
        sellingParty: d.sellingParty?.partyId ?? null,
        shipToParty: d.shipToParty?.partyId ?? null,
        itemCount: Array.isArray(d.items) ? d.items.length : 0,
        raw: o,
      });
    }
    nextToken = j.payload?.pagination?.nextToken;
    pages += 1;
  } while (nextToken && pages < 50);
  return out;
}

// ── Reports API (the standard create → poll → download flow) ─────────────────

export interface ReportDoc {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string;
}

/** Request a report; returns the reportId. */
export async function createReport(reportType: string, opts?: { dataStartTime?: string; dataEndTime?: string }): Promise<string> {
  const j = await spJson<{ reportId: string }>("/reports/2021-06-30/reports", {
    method: "POST",
    body: JSON.stringify({
      reportType,
      marketplaceIds: [marketplaceId()],
      ...(opts?.dataStartTime ? { dataStartTime: opts.dataStartTime } : {}),
      ...(opts?.dataEndTime ? { dataEndTime: opts.dataEndTime } : {}),
    }),
  });
  return j.reportId;
}

export async function getReport(reportId: string): Promise<{ processingStatus: string; reportDocumentId?: string }> {
  return spJson(`/reports/2021-06-30/reports/${reportId}`);
}

export async function getReportDocument(reportDocumentId: string): Promise<ReportDoc> {
  return spJson(`/reports/2021-06-30/documents/${reportDocumentId}`);
}

/** Download + decompress a report document into text. */
export async function downloadReportDocument(doc: ReportDoc): Promise<string> {
  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`Report document download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return doc.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

/** Convenience: create a report, poll until done (bounded), and return its text. */
export async function fetchReport(
  reportType: string,
  opts?: { dataStartTime?: string; dataEndTime?: string; maxWaitMs?: number },
): Promise<string> {
  const reportId = await createReport(reportType, opts);
  const deadline = Date.now() + (opts?.maxWaitMs ?? 90_000);
  // Poll (SP-API has no push here); back off a little between checks.
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const r = await getReport(reportId);
    if (r.processingStatus === "DONE" && r.reportDocumentId) {
      const doc = await getReportDocument(r.reportDocumentId);
      return downloadReportDocument(doc);
    }
    if (r.processingStatus === "CANCELLED" || r.processingStatus === "FATAL") {
      throw new Error(`Report ${reportType} ${r.processingStatus}`);
    }
    await new Promise((res) => setTimeout(res, Math.min(2000 + attempt * 1000, 8000)));
  }
  throw new Error(`Report ${reportType} timed out`);
}
