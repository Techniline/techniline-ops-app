/**
 * Zoho CRM server-side client (OAuth refresh-token flow). Server-only — never
 * import from client components. Requires ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET /
 * ZOHO_REFRESH_TOKEN; ZOHO_DC defaults to "com".
 */

import { buildDealUrl } from "./dealId";

function dc(): string {
  return process.env.ZOHO_DC || "com";
}

/** Org id used to build canonical deal URLs (from ZOHO_ORG_ID; falls back to the known org). */
function orgId(): string {
  return process.env.ZOHO_ORG_ID || "712284897";
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

// ── Back-to-Back deal creation for abandoned carts ──────────────────────────

interface ZohoContact {
  id: string;
  name: string | null;
}

/** Find a Contact by email (dedup key). Returns null if none / on error. */
async function searchContactByEmail(email: string): Promise<ZohoContact | null> {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.zohoapis.${dc()}/crm/v5/Contacts/search?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    if (res.status === 204) return null;
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ id?: string; Full_Name?: string | null }> };
    const c = json.data?.[0];
    if (!c?.id) return null;
    return { id: c.id, name: c.Full_Name ?? null };
  } catch {
    return null;
  }
}

/** Does this contact already have a deal? (used to refuse duplicates). */
async function firstDealForContact(contactId: string): Promise<{ id: string; name: string | null } | null> {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.zohoapis.${dc()}/crm/v5/Contacts/${encodeURIComponent(contactId)}/Deals?fields=Deal_Name&per_page=1`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    if (res.status === 204) return null;
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ id?: string; Deal_Name?: string | null }> };
    const d = json.data?.[0];
    if (!d?.id) return null;
    return { id: d.id, name: d.Deal_Name ?? null };
  } catch {
    return null;
  }
}

export type CreateDealOutcome =
  | { status: "created"; dealId: string; dealUrl: string; message: string }
  | { status: "duplicate"; dealId: string; dealUrl: string; message: string }
  | { status: "error"; message: string };

export interface NewDealInput {
  customerName: string | null;
  customerEmail: string | null;
  amount: number | null;
  recoveryUrl: string | null;
}

/**
 * Create a deal in the Back-to-Back pipeline for an abandoned cart, after a
 * duplicate check by customer email. Deal name = "<customer> – MM Cart" (Aaron
 * edits in CRM). Pipeline/stage come from ZOHO_MM_PIPELINE / ZOHO_MM_STAGE.
 */
export async function createBackToBackDeal(input: NewDealInput): Promise<CreateDealOutcome> {
  try {
    const email = (input.customerEmail ?? "").trim();
    let contactId: string | null = null;

    // 1) Dedup by email.
    if (email) {
      const contact = await searchContactByEmail(email);
      if (contact) {
        contactId = contact.id;
        const existing = await firstDealForContact(contact.id);
        if (existing) {
          return {
            status: "duplicate",
            dealId: existing.id,
            dealUrl: buildDealUrl(orgId(), existing.id),
            message: `A deal already exists for ${email}${existing.name ? ` (“${existing.name}”)` : ""}.`,
          };
        }
      }
    }

    // 2) Create the deal.
    const token = await getAccessToken();
    const customer = (input.customerName ?? "").trim() || (email ? email.split("@")[0] : "Music Majlis");
    const record: Record<string, unknown> = {
      Deal_Name: `${customer} – MM Cart`,
      Pipeline: process.env.ZOHO_MM_PIPELINE || "Back to Back",
      Stage: process.env.ZOHO_MM_STAGE || "Qualification",
      Description: [
        "Created from a Music Majlis abandoned cart.",
        email ? `Email: ${email}` : null,
        input.recoveryUrl ? `Recovery: ${input.recoveryUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };
    if (input.amount != null && Number.isFinite(input.amount)) record.Amount = input.amount;
    if (contactId) record.Contact_Name = { id: contactId };

    const res = await fetch(`https://www.zohoapis.${dc()}/crm/v5/Deals`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: [record] }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ code?: string; details?: { id?: string }; message?: string }>;
    };
    const row = json.data?.[0];
    if (!res.ok || row?.code !== "SUCCESS" || !row.details?.id) {
      return { status: "error", message: row?.message ? `Zoho: ${row.message}` : `Zoho create failed (${res.status}).` };
    }
    const id = row.details.id;
    return {
      status: "created",
      dealId: id,
      dealUrl: buildDealUrl(orgId(), id),
      message: "Deal created in Back-to-Back. Open it in CRM to finish the details.",
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Zoho request failed." };
  }
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
