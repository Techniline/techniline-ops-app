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

interface RawOrder {
  current_total_price?: string | null;
  total_price?: string | null;
}
interface OrdersResp {
  orders?: RawOrder[];
}

/**
 * Month-to-date net sales (sum of current_total_price, which already reflects
 * refunds) + count of abandoned checkouts. Paginated via the Link header, capped
 * to keep the request bounded.
 */
export async function fetchMonthMetrics(
  fromIso: string,
  toIso: string
): Promise<{ netSales: number; orderCount: number; abandonedCarts: number }> {
  let netSales = 0;
  let orderCount = 0;

  // Orders (paged). Use the REST Link-header cursor.
  let url: string | null =
    `/orders.json?status=any&limit=250&fields=current_total_price,total_price` +
    `&created_at_min=${encodeURIComponent(fromIso)}&created_at_max=${encodeURIComponent(toIso)}`;
  let pages = 0;
  while (url && pages < 40) {
    const res: Response = await shopGet(url);
    if (!res.ok) throw new Error(`Shopify orders ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = (await res.json()) as OrdersResp;
    for (const o of json.orders ?? []) {
      const v = Number(o.current_total_price ?? o.total_price ?? 0);
      if (Number.isFinite(v)) netSales += v;
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
