/**
 * Noon Partners Vendor API client (server-only).
 * Auth flow: build RS256 JWT → POST /identity/public/v1/api/login → session cookie → use cookie.
 *
 * Required env vars:
 *   NOON_KEY_ID        — key_id from the credential JSON
 *   NOON_PRIVATE_KEY   — full PEM private key block (with literal \n escaped newlines)
 *   NOON_PROJECT_CODE  — project_code from the credential JSON
 */
import { createSign, randomUUID } from "node:crypto";

const API_BASE = "https://noon-api-gateway.noon.partners";
const USER_AGENT = "TechnilineOps/1.0";

function cfg() {
  return {
    keyId: process.env.NOON_KEY_ID ?? "",
    privateKey: (process.env.NOON_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    projectCode: process.env.NOON_PROJECT_CODE ?? "",
  };
}

export function noonConfigured(): boolean {
  const c = cfg();
  return Boolean(c.keyId && c.privateKey && c.projectCode);
}

// ── JWT generation ────────────────────────────────────────────────────────────

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function buildJWT(): string {
  const { keyId, privateKey } = cfg();
  if (!keyId || !privateKey) {
    throw new Error("Noon API not configured — set NOON_KEY_ID and NOON_PRIVATE_KEY.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: keyId }));
  const payload = b64url(JSON.stringify({ sub: keyId, iat: now, jti: randomUUID() }));
  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const sig = Buffer.from(sign.sign(privateKey, "base64"), "base64").toString("base64url");
  return `${unsigned}.${sig}`;
}

// ── Session cookie cache ──────────────────────────────────────────────────────

let sessionCache: { cookie: string; expiresAt: number } | null = null;

async function getSessionCookie(): Promise<string> {
  if (sessionCache && sessionCache.expiresAt > Date.now() + 60_000) {
    return sessionCache.cookie;
  }

  const { projectCode } = cfg();

  // Retry login up to 3 times on transient 5xx errors
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 3_000 * attempt));
    res = await fetch(`${API_BASE}/identity/public/v1/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ token: buildJWT(), default_project_code: projectCode }),
    });
    if (res.status < 500) break;
    lastErr = `${res.status}: ${(await res.text()).slice(0, 200)}`;
    res = null;
  }
  if (!res) throw new Error(`Noon login failed after retries — last error: ${lastErr}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Noon login failed ${res.status}: ${text.slice(0, 300)}`);
  }

  // Node 18+ fetch exposes getSetCookie(); fall back to get() for older runtimes.
  const rawCookies: string[] =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie") ?? ""].filter(Boolean);

  if (!rawCookies.length) {
    throw new Error("Noon login succeeded but no session cookie returned.");
  }

  // Keep only the name=value part of each cookie (strip attributes).
  const cookie = rawCookies.map((c) => c.split(";")[0].trim()).join("; ");
  sessionCache = { cookie, expiresAt: Date.now() + 50 * 60 * 1000 };
  return cookie;
}

function invalidateSession() {
  sessionCache = null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function reqHeaders(cookie: string, extra?: Record<string, string>): Record<string, string> {
  return { Cookie: cookie, "Content-Type": "application/json", "User-Agent": USER_AGENT, ...extra };
}

export async function noonGet<T>(path: string, qs?: Record<string, string>): Promise<T> {
  const cookie = await getSessionCookie();
  const url = new URL(`${API_BASE}${path}`);
  if (qs) Object.entries(qs).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: reqHeaders(cookie) });
  if (res.status === 401 || res.status === 403) {
    invalidateSession();
    throw new Error(`Noon GET ${path} ${res.status}: session rejected — will re-login on next call`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Noon GET ${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function noonPost<T>(path: string, body: unknown): Promise<T> {
  const cookie = await getSessionCookie();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: reqHeaders(cookie),
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    invalidateSession();
    throw new Error(`Noon POST ${path} ${res.status}: session rejected — will re-login on next call`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Noon POST ${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const FBP_RETURNS_BASE = "https://mp-partners-fbp-returns.noon.partners";
const MP_PARTNERS_BASE = "https://mp-partners.noon.partners";

export async function noonFbpGet<T>(path: string, qs?: Record<string, string>): Promise<T> {
  const cookie = await getSessionCookie();
  const url = new URL(`${FBP_RETURNS_BASE}${path}`);
  if (qs) Object.entries(qs).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: reqHeaders(cookie) });
  if (res.status === 401 || res.status === 403) {
    invalidateSession();
    throw new Error(`Noon FBP GET ${path} ${res.status}: session rejected`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Noon FBP GET ${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Probe an arbitrary full URL with the Noon session cookie; returns {status, body}. */
export async function noonProbeUrl(fullUrl: string): Promise<{ status: number; body: string }> {
  const cookie = await getSessionCookie();
  const res = await fetch(fullUrl, { headers: reqHeaders(cookie) });
  const body = await res.text();
  return { status: res.status, body: body.slice(0, 300) };
}

export async function noonMpGet<T>(path: string, qs?: Record<string, string>): Promise<T> {
  const cookie = await getSessionCookie();
  const url = new URL(`${MP_PARTNERS_BASE}${path}`);
  if (qs) Object.entries(qs).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: reqHeaders(cookie) });
  if (res.status === 401 || res.status === 403) {
    invalidateSession();
    throw new Error(`Noon MP GET ${path} ${res.status}: session rejected`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Noon MP GET ${MP_PARTNERS_BASE}${path} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = parseCsvRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

// ── Async impex export ────────────────────────────────────────────────────────

export async function noonExport(
  categoryCode: string,
  params: Record<string, string>,
  timeoutMs = 180_000,
): Promise<string> {
  const { export_code } = await noonPost<{ export_code: string }>("/impex/v1/export/create", {
    export_category_code: categoryCode,
    params,
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 3_000));
    let status: { export_status: string; download_url?: string | null };
    try {
      status = await noonPost<typeof status>("/impex/v1/export/status", { export_code });
    } catch (e) {
      // 5xx errors from Noon's gateway are transient — keep polling
      const msg = e instanceof Error ? e.message : "";
      if (/\b50[234]\b/.test(msg)) continue;
      throw e;
    }
    if (status.export_status === "COMPLETE") {
      if (!status.download_url) throw new Error(`Noon export ${export_code} complete but no download_url`);
      const dlRes = await fetch(status.download_url);
      if (!dlRes.ok) throw new Error(`Noon export download failed: ${dlRes.status}`);
      return dlRes.text();
    }
    if (status.export_status === "ERROR") {
      throw new Error(`Noon export ${export_code} failed with ERROR status`);
    }
  }
  throw new Error(`Noon export ${export_code} timed out after ${timeoutMs}ms`);
}

// ── Connectivity check ────────────────────────────────────────────────────────

export async function noonPing(): Promise<{ ok: boolean; detail: string }> {
  try {
    if (!noonConfigured()) return { ok: false, detail: "Noon credentials not set in env vars." };
    const data = await noonGet<unknown>("/identity/v1/whoami");
    return { ok: true, detail: `Logged in as: ${JSON.stringify(data).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Unknown error." };
  }
}
