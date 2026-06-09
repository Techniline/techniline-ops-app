/**
 * Zoho CRM server-side client (OAuth refresh-token flow). Server-only — never
 * import from client components. Requires ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET /
 * ZOHO_REFRESH_TOKEN; ZOHO_DC defaults to "com".
 */

function dc(): string {
  return process.env.ZOHO_DC || "com";
}

/** True when the Zoho OAuth env is configured (else callers fall back to pending). */
export function zohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN
  );
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? "",
  });
  const res = await fetch(`https://accounts.zoho.${dc()}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`Zoho token error: ${json.error ?? res.status}`);
  }
  tokenCache = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export interface ZohoDeal {
  id: string;
  dealName: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  stage: string | null;
  amount: number | null;
  createdTime: string | null;
  accountName: string | null;
  contactName: string | null;
}

/** Possible outcomes of a deal validation. */
export type ZohoValidation =
  | { status: "valid"; deal: ZohoDeal }
  | { status: "invalid"; message: string }
  | { status: "api_error"; message: string };

interface RawZohoDeal {
  id?: string;
  Deal_Name?: string | null;
  Owner?: { name?: string | null; email?: string | null } | null;
  Stage?: string | null;
  Amount?: number | null;
  Created_Time?: string | null;
  Account_Name?: { name?: string | null } | null;
  Contact_Name?: { name?: string | null } | null;
}

/** Look up a deal by id. Distinguishes not-found (invalid) from call failures (api_error). */
export async function validateDeal(dealId: string): Promise<ZohoValidation> {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.zohoapis.${dc()}/crm/v5/Deals/${encodeURIComponent(dealId)}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    if (res.status === 204 || res.status === 404) {
      return { status: "invalid", message: "No deal found for that id." };
    }
    if (!res.ok) {
      const t = await res.text();
      return { status: "api_error", message: `Zoho ${res.status}: ${t.slice(0, 160)}` };
    }
    const json = (await res.json()) as { data?: RawZohoDeal[] };
    const d = json.data?.[0];
    if (!d || !d.id) return { status: "invalid", message: "Deal response was empty." };
    return {
      status: "valid",
      deal: {
        id: d.id,
        dealName: d.Deal_Name ?? null,
        ownerName: d.Owner?.name ?? null,
        ownerEmail: d.Owner?.email ?? null,
        stage: d.Stage ?? null,
        amount: typeof d.Amount === "number" ? d.Amount : null,
        createdTime: d.Created_Time ?? null,
        accountName: d.Account_Name?.name ?? null,
        contactName: d.Contact_Name?.name ?? null,
      },
    };
  } catch (e) {
    return { status: "api_error", message: e instanceof Error ? e.message : "Zoho request failed." };
  }
}
