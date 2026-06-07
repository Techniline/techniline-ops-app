/**
 * Microsoft Graph client (application/client-credentials). Server-only.
 * Requires AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET with the
 * Mail.Read application permission (admin-consented) for the target mailboxes.
 */

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getGraphToken(): Promise<string> {
  const tenant = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const secret = process.env.AZURE_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) {
    throw new Error(
      "Azure Graph env not configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)."
    );
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: secret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as TokenResponse;
  tokenCache = { token: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return json.access_token;
}

export interface GraphMessage {
  id: string;
  internetMessageId: string | null;
  subject: string | null;
  fromAddress: string | null;
  receivedDateTime: string | null;
  bodyContent: string | null;
}

interface GraphRawMessage {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  receivedDateTime?: string;
  body?: { content?: string; contentType?: string };
}
interface GraphListResponse {
  value: GraphRawMessage[];
  "@odata.nextLink"?: string;
}

/**
 * Fetch inbox message HEADERS for a mailbox received on/after `sinceIso`, newest
 * first, up to `cap`. Bodies are intentionally NOT requested here — downloading
 * bodies for every inbox email is the slow part, and `isAmazonEmail` only needs
 * subject + sender. Call `fetchBody` for the few messages that actually match.
 */
export async function fetchMessages(
  mailbox: string,
  sinceIso: string,
  cap = Number(process.env.INGEST_FETCH_CAP ?? "1000") || 1000
): Promise<GraphMessage[]> {
  const token = await getGraphToken();

  const params = new URLSearchParams();
  params.set("$select", "id,internetMessageId,subject,from,receivedDateTime");
  params.set("$top", "50");
  params.set("$orderby", "receivedDateTime desc");
  params.set("$filter", `receivedDateTime ge ${sinceIso}`);

  let url:
    | string
    | undefined = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    mailbox
  )}/mailFolders/inbox/messages?${params.toString()}`;

  const out: GraphMessage[] = [];
  while (url && out.length < cap) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Graph messages error ${res.status} for ${mailbox}: ${text.slice(0, 300)}`
      );
    }
    const json = (await res.json()) as GraphListResponse;
    for (const r of json.value) {
      out.push({
        id: r.id,
        internetMessageId: r.internetMessageId ?? null,
        subject: r.subject ?? null,
        fromAddress: r.from?.emailAddress?.address ?? null,
        receivedDateTime: r.receivedDateTime ?? null,
        bodyContent: null,
      });
    }
    url = json["@odata.nextLink"];
  }
  return out;
}

/**
 * Fetch the plain-text body for a single message. Returns null on any failure
 * (the parser tolerates a missing body — it can still classify from the subject).
 */
export async function fetchBody(
  mailbox: string,
  messageId: string
): Promise<string | null> {
  const token = await getGraphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      mailbox
    )}/messages/${encodeURIComponent(messageId)}?$select=body`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { body?: { content?: string } };
  return json.body?.content ?? null;
}
