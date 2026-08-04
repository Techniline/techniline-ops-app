/**
 * Fetch buyer messages from the Noon partner portal.
 *
 * Noon's buyer messaging API is on mp-partners.noon.partners and uses the same
 * session cookie as the FBP returns portal. The endpoint pattern follows the
 * standard /_vs/mp/{service}/{resource}/list shape.
 */
import { noonMpGet } from "./client";
import type { NoonMessage } from "./types";

// Raw shape returned by Noon's messaging API (field names may vary — we handle
// multiple possible structures via optional chaining).
interface RawMsg {
  id?: string;
  messageId?: string;
  message_id?: string;
  orderId?: string;
  order_id?: string;
  orderNumber?: string;
  order_number?: string;
  order_nr?: string;
  threadId?: string;
  thread_id?: string;
  buyerAlias?: string;
  buyer_alias?: string;
  buyerName?: string;
  buyer_name?: string;
  subject?: string;
  messageText?: string;
  message_text?: string;
  body?: string;
  content?: string;
  text?: string;
  direction?: string;
  type?: string;         // e.g. "BUYER_TO_SELLER" | "SELLER_TO_BUYER"
  isRead?: boolean;
  is_read?: boolean;
  read?: boolean;
  replied?: boolean;
  is_replied?: boolean;
  createdAt?: string;
  created_at?: string;
  sentAt?: string;
  sent_at?: string;
  timestamp?: string;
}

interface RawResponse {
  items?: RawMsg[];
  records?: RawMsg[];
  data?: RawMsg[];
  messages?: RawMsg[];
  total?: number;
  total_records?: number;
  page?: number;
}

function mapMsg(r: RawMsg, idx: number): NoonMessage | null {
  const id = r.messageId ?? r.message_id ?? r.id ?? `msg-${idx}`;
  const body = r.messageText ?? r.message_text ?? r.body ?? r.content ?? r.text ?? "";
  const sentAt =
    r.sentAt ?? r.sent_at ?? r.createdAt ?? r.created_at ?? r.timestamp ?? new Date().toISOString();
  const orderNr = r.orderNumber ?? r.order_number ?? r.order_nr ?? r.orderId ?? r.order_id;

  // Treat SELLER_TO_BUYER type as outbound
  const typeStr = (r.type ?? r.direction ?? "").toLowerCase();
  const direction: "inbound" | "outbound" =
    typeStr.includes("seller") || typeStr === "outbound" ? "outbound" : "inbound";

  const isRead = r.isRead ?? r.is_read ?? r.read ?? false;
  const replied = r.replied ?? r.is_replied ?? false;

  return {
    message_id: id,
    order_nr: orderNr,
    thread_id: r.threadId ?? r.thread_id,
    buyer_name: r.buyerAlias ?? r.buyer_alias ?? r.buyerName ?? r.buyer_name,
    subject: r.subject,
    body,
    direction,
    sent_at: sentAt,
    is_read: isRead,
    replied,
  };
}

function extractItems(res: RawResponse): RawMsg[] {
  return res.items ?? res.records ?? res.data ?? res.messages ?? [];
}

export async function fetchNoonMessages(maxPages = 5): Promise<NoonMessage[]> {
  const all: NoonMessage[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const res = await noonMpGet<RawResponse>(
      "/_vs/mp/mp-messaging-api-sellerlab/buyer_message/list",
      { page: String(page), limit: "50" },
    );
    const items = extractItems(res);
    if (!items.length) break;
    items.forEach((r, i) => {
      const m = mapMsg(r, (page - 1) * 50 + i);
      if (m) all.push(m);
    });
    const total = res.total ?? res.total_records ?? 0;
    if (all.length >= total || items.length < 50) break;
  }

  return all;
}
