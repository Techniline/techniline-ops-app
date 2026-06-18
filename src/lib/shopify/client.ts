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

async function shopPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": cfg().token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface RawRefundLineItem {
  subtotal?: number | string | null;
}
interface RawRefund {
  refund_line_items?: RawRefundLineItem[] | null;
}
interface RawOrder {
  created_at?: string | null;
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
 * Also returns net sales bucketed by Dubai day (YYYY-MM-DD) for the pace chart.
 */
export async function fetchMonthMetrics(
  fromIso: string,
  toIso: string
): Promise<{ netSales: number; orderCount: number; abandonedCarts: number; daily: Record<string, number> }> {
  let netSales = 0;
  let orderCount = 0;
  const daily: Record<string, number> = {};

  // Orders (paged). Use the REST Link-header cursor.
  let url: string | null =
    `/orders.json?status=any&limit=250&fields=created_at,subtotal_price,current_total_price,total_price,cancelled_at,refunds` +
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
      if (Number.isFinite(net)) {
        netSales += net;
        if (o.created_at) {
          const day = new Date(new Date(o.created_at).getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
          daily[day] = (daily[day] ?? 0) + net;
        }
      }
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

  return { netSales: Number(netSales.toFixed(2)), orderCount, abandonedCarts, daily };
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

// ── Logistics: full order sync + fulfillment push ───────────────────────────

export interface SyncLineItem {
  shopifyLineId: string;
  title: string | null;
  sku: string | null;
  brand: string | null; // Shopify "vendor"
  qty: number;
  unitPrice: number | null;
  totalPrice: number | null;
  fulfilledQty: number;
}

export interface SyncOrder {
  shopifyOrderId: string;
  orderNumber: string | null;
  shopifyCreatedAt: string | null;
  fulfillmentStatus: string | null;
  financialStatus: string | null;
  customerName: string | null;
  orderValue: number | null;
  currency: string | null;
  paymentMethod: string | null;
  shippingPhone: string | null;
  shippingMethod: string | null;
  shippingCity: string | null;
  email: string | null;
  deliveryAddress: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  items: SyncLineItem[];
  raw: unknown;
}

interface RawLineItem {
  id?: number | string;
  title?: string | null;
  sku?: string | null;
  vendor?: string | null;
  quantity?: number | null;
  fulfillable_quantity?: number | null;
  price?: string | null;
}
interface RawShippingLine {
  title?: string | null;
}
interface RawAddress {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  phone?: string | null;
}
interface RawFullOrder {
  id?: number | string;
  name?: string | null;
  created_at?: string | null;
  cancelled_at?: string | null;
  closed_at?: string | null;
  fulfillment_status?: string | null;
  financial_status?: string | null;
  currency?: string | null;
  total_price?: string | null;
  current_total_price?: string | null;
  email?: string | null;
  phone?: string | null;
  payment_gateway_names?: string[] | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  shipping_address?: RawAddress | null;
  shipping_lines?: RawShippingLine[] | null;
  line_items?: RawLineItem[] | null;
}

function formatAddress(a: RawAddress | null | undefined): string | null {
  if (!a) return null;
  const parts = [a.address1, a.address2, a.city, a.province, a.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Fetch full orders (with line items, customer, shipping) created on/after
 * `sinceIso`, for syncing into the logistics tables. Paged via the Link header.
 */
export async function fetchOrdersForSync(
  sinceIso: string,
  untilIso?: string,
  opts?: { by?: "created" | "updated" },
): Promise<SyncOrder[]> {
  const by = opts?.by ?? "created";
  const out: SyncOrder[] = [];
  let url: string | null =
    `/orders.json?status=any&limit=250&${by}_at_min=${encodeURIComponent(sinceIso)}` +
    (untilIso ? `&${by}_at_max=${encodeURIComponent(untilIso)}` : "");
  let pages = 0;
  while (url && pages < 120) {
    const res: Response = await shopGet(url);
    if (!res.ok) throw new Error(`Shopify orders ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { orders?: RawFullOrder[] };
    for (const o of json.orders ?? []) {
      const name = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ").trim();
      const amt = Number(o.current_total_price ?? o.total_price ?? 0);
      // Shopify's order-level fulfillment_status is unreliable (often null even
      // when fulfilled, since fulfillment moved to a separate model). Trust it
      // only when it says fulfilled/partial; otherwise derive from the line
      // items' fulfillable_quantity (0 remaining = that unit is fulfilled).
      const liArr = o.line_items ?? [];
      let totQty = 0;
      let fulQty = 0;
      for (const li of liArr) {
        const q = Number(li.quantity ?? 0);
        const f = Number(li.fulfillable_quantity ?? q);
        totQty += q;
        fulQty += Math.max(0, q - f);
      }
      const orderFs = (o.fulfillment_status ?? "").toLowerCase();
      const fulfillmentStatus =
        orderFs === "fulfilled" || orderFs === "partial"
          ? orderFs
          : totQty > 0 && fulQty >= totQty
            ? "fulfilled"
            : fulQty > 0
              ? "partial"
              : "unfulfilled";
      out.push({
        shopifyOrderId: String(o.id ?? ""),
        orderNumber: o.name ?? null,
        shopifyCreatedAt: o.created_at ?? null,
        fulfillmentStatus,
        financialStatus: o.financial_status ?? null,
        customerName: name || null,
        orderValue: Number.isFinite(amt) ? amt : null,
        currency: o.currency ?? "AED",
        paymentMethod: (o.payment_gateway_names ?? []).join(", ") || null,
        shippingPhone: o.shipping_address?.phone ?? o.phone ?? null,
        shippingMethod: (o.shipping_lines ?? [])[0]?.title ?? null,
        shippingCity: o.shipping_address?.city ?? null,
        email: o.email ?? null,
        deliveryAddress: formatAddress(o.shipping_address),
        cancelledAt: o.cancelled_at ?? null,
        closedAt: o.closed_at ?? null,
        items: (o.line_items ?? []).map((li) => {
          const price = Number(li.price ?? 0);
          const qty = Number(li.quantity ?? 0);
          const fulfillable = Number(li.fulfillable_quantity ?? qty);
          return {
            shopifyLineId: String(li.id ?? ""),
            title: li.title ?? null,
            sku: li.sku ?? null,
            brand: li.vendor ?? null,
            qty,
            unitPrice: Number.isFinite(price) ? price : null,
            totalPrice: Number.isFinite(price) ? Number((price * qty).toFixed(2)) : null,
            fulfilledQty: Math.max(0, qty - fulfillable),
          };
        }),
        raw: o,
      });
    }
    const link = res.headers.get("link") || res.headers.get("Link");
    const next = link?.split(",").find((p) => p.includes('rel="next"'));
    const m = next?.match(/<[^>]*\/admin\/api\/[^>]*(\/orders\.json[^>]*)>/);
    url = m ? m[1] : null;
    pages += 1;
  }
  return out;
}

export type FulfillmentResult =
  | { ok: true; fulfillmentId: string }
  | { ok: false; message: string };

interface RawFulfillmentOrder {
  id?: number | string;
  status?: string | null;
  line_items?: { id?: number | string }[] | null;
}

/**
 * Push a fulfillment + tracking to Shopify for an order. Uses the modern
 * fulfillment-orders flow (REST 2024-10): list open fulfillment orders, then
 * create a fulfillment across them with tracking info. Returns a structured
 * result so callers can keep the internal record + retry on failure.
 */
export async function pushFulfillment(
  shopifyOrderId: string,
  tracking: { number: string | null; url: string | null; company: string | null; notify: boolean }
): Promise<FulfillmentResult> {
  try {
    const foRes = await shopGet(`/orders/${shopifyOrderId}/fulfillment_orders.json`);
    if (!foRes.ok) {
      return { ok: false, message: `Shopify fulfillment_orders ${foRes.status}: ${(await foRes.text()).slice(0, 160)}` };
    }
    const foJson = (await foRes.json()) as { fulfillment_orders?: RawFulfillmentOrder[] };
    const open = (foJson.fulfillment_orders ?? []).filter(
      (fo) => fo.status === "open" || fo.status === "in_progress" || fo.status === "scheduled"
    );
    if (open.length === 0) {
      return { ok: false, message: "No open fulfillment orders (already fulfilled or unfulfillable)." };
    }
    const line_items_by_fulfillment_order = open.map((fo) => ({
      fulfillment_order_id: fo.id,
    }));
    const body = {
      fulfillment: {
        notify_customer: tracking.notify,
        tracking_info: {
          number: tracking.number ?? undefined,
          url: tracking.url ?? undefined,
          company: tracking.company ?? undefined,
        },
        line_items_by_fulfillment_order,
      },
    };
    const res = await shopPost(`/fulfillments.json`, body);
    if (!res.ok) {
      return { ok: false, message: `Shopify fulfillment ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const j = (await res.json()) as { fulfillment?: { id?: number | string } };
    return { ok: true, fulfillmentId: String(j.fulfillment?.id ?? "") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Shopify request failed." };
  }
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
