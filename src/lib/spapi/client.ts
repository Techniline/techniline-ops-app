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
