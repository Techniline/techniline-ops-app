/**
 * Shopify Admin API client (server-only). Requires SHOPIFY_STORE_DOMAIN
 * (e.g. myshop.myshopify.com), SHOPIFY_ADMIN_TOKEN (Admin API access token of a
 * custom app with read_orders + read_checkouts), and optional SHOPIFY_API_VERSION.
 * Never import from client components.
 */

function cfg() {
  return {
    domain: process.env.SHOPIFY_STORE_DOMAIN || "",
    token: process.env.SHOPIFY_ADMIN_TOKEN || "",
    version: process.env.SHOPIFY_API_VERSION || "2024-10",
  };
}

export function shopifyConfigured(): boolean {
  const c = cfg();
  return Boolean(c.domain && c.token);
}

function base(): string {
  const c = cfg();
  return `https://${c.domain}/admin/api/${c.version}`;
}

async function shopGet(path: string): Promise<Response> {
  return fetch(`${base()}${path}`, {
    headers: { "X-Shopify-Access-Token": cfg().token, "Content-Type": "application/json" },
  });
}

interface RawRefundLineItem {
  subtotal?: number | string | null;
}
interface RawRefund {
  refund_line_items?: RawRefundLineItem[] | null;
}
interface RawOrder {
  subtotal_price?: string | null;
  current_total_price?: string | null;
  total_price?: string | null;
  cancelled_at?: string | null;
  refunds?: RawRefund[] | null;
}
interface OrdersResp {
  orders?: RawOrder[];
}

/**
 * Month-to-date **net sales** matching Shopify's definition: gross − discounts −
 * returns, EXCLUDING tax & shipping. We sum `subtotal_price` (line totals after
 * all discounts, before tax/shipping) and subtract refunded line-item subtotals
 * (returns). Paginated via the Link header; cancelled orders are skipped.
 */
export async function fetchMonthMetrics(
  fromIso: string,
  toIso: string
): Promise<{ netSales: number; orderCount: number; abandonedCarts: number }> {
  let netSales = 0;
  let orderCount = 0;

  // Orders (paged). Use the REST Link-header cursor.
  let url: string | null =
    `/orders.json?status=any&limit=250&fields=subtotal_price,current_total_price,total_price,cancelled_at,refunds` +
    `&created_at_min=${encodeURIComponent(fromIso)}&created_at_max=${encodeURIComponent(toIso)}`;
  let pages = 0;
  while (url && pages < 40) {
    const res: Response = await shopGet(url);
    if (!res.ok) throw new Error(`Shopify orders ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = (await res.json()) as OrdersResp;
    for (const o of json.orders ?? []) {
      if (o.cancelled_at) continue; // cancelled orders don't count toward sales
      const subtotal = Number(o.subtotal_price ?? 0); // after discounts, before tax/shipping
      let returns = 0;
      for (const r of o.refunds ?? []) {
        for (const li of r.refund_line_items ?? []) {
          const s = Number(li.subtotal ?? 0);
          if (Number.isFinite(s)) returns += s;
        }
      }
      const net = subtotal - returns;
      if (Number.isFinite(net)) netSales += net;
      orderCount += 1;
    }
    // Parse next cursor from Link header.
    const link = res.headers.get("link") || res.headers.get("Link");
    const next = link?.split(",").find((p) => p.includes('rel="next"'));
    const m = next?.match(/<[^>]*\/admin\/api\/[^>]*(\/orders\.json[^>]*)>/);
    url = m ? m[1] : null;
    pages += 1;
  }

  // Abandoned checkouts count for the period.
  let abandonedCarts = 0;
  try {
    const res = await shopGet(`/checkouts/count.json?created_at_min=${encodeURIComponent(fromIso)}`);
    if (res.ok) {
      const j = (await res.json()) as { count?: number };
      abandonedCarts = j.count ?? 0;
    }
  } catch {
    /* abandoned-cart count is best-effort */
  }

  return { netSales: Number(netSales.toFixed(2)), orderCount, abandonedCarts };
}

export interface AbandonedCheckout {
  id: string;
  createdAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  total: number | null;
  recoveryUrl: string | null;
}

interface RawCheckout {
  id?: number | string;
  created_at?: string | null;
  email?: string | null;
  total_price?: string | null;
  abandoned_checkout_url?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
}

/**
 * Abandoned checkouts created within [fromIso, toIso). Returns the individual
 * carts (id, customer, total, recovery URL) so they can be actioned one by one.
 * Paged via the Link header; bounded.
 */
export async function fetchAbandonedCheckouts(fromIso: string, toIso: string): Promise<AbandonedCheckout[]> {
  const out: AbandonedCheckout[] = [];
  let url: string | null =
    `/checkouts.json?limit=250` +
    `&created_at_min=${encodeURIComponent(fromIso)}&created_at_max=${encodeURIComponent(toIso)}`;
  let pages = 0;
  while (url && pages < 20) {
    const res: Response = await shopGet(url);
    if (!res.ok) throw new Error(`Shopify checkouts ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = (await res.json()) as { checkouts?: RawCheckout[] };
    for (const c of json.checkouts ?? []) {
      const name = [c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(" ").trim();
      const amt = Number(c.total_price ?? 0);
      out.push({
        id: String(c.id ?? ""),
        createdAt: c.created_at ?? null,
        customerName: name || null,
        customerEmail: c.email ?? null,
        total: Number.isFinite(amt) ? amt : null,
        recoveryUrl: c.abandoned_checkout_url ?? null,
      });
    }
    const link = res.headers.get("link") || res.headers.get("Link");
    const next = link?.split(",").find((p) => p.includes('rel="next"'));
    const m = next?.match(/<[^>]*\/admin\/api\/[^>]*(\/checkouts\.json[^>]*)>/);
    url = m ? m[1] : null;
    pages += 1;
  }
  return out;
}

export type OrderValidation =
  | { status: "valid"; orderName: string; amount: number | null }
  | { status: "invalid"; message: string }
  | { status: "api_error"; message: string };

interface RawNamedOrder {
  name?: string;
  current_total_price?: string | null;
  total_price?: string | null;
}

/** Confirm a recovered order exists (search by order name/number). */
export async function validateOrder(orderRef: string): Promise<OrderValidation> {
  try {
    const name = orderRef.trim();
    const res = await shopGet(`/orders.json?status=any&name=${encodeURIComponent(name)}&fields=name,current_total_price,total_price&limit=1`);
    if (!res.ok) {
      return { status: "api_error", message: `Shopify ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }
    const j = (await res.json()) as { orders?: RawNamedOrder[] };
    const o = j.orders?.[0];
    if (!o) return { status: "invalid", message: "No Shopify order found with that number." };
    const amt = Number(o.current_total_price ?? o.total_price ?? 0);
    return { status: "valid", orderName: o.name ?? name, amount: Number.isFinite(amt) ? amt : null };
  } catch (e) {
    return { status: "api_error", message: e instanceof Error ? e.message : "Shopify request failed." };
  }
}
