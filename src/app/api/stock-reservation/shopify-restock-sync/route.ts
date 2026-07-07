import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";

// ── Restock ETA → Shopify sync (on-demand) ─────────────────────────────────────
//
// Manager-triggered counterpart to the scheduled "MusicMajlis Restock ETA Sync"
// Windows Task (same logic, same Supabase tables). This route is stateless: it
// never reads/writes a local state file. Instead, on every call it re-derives
// the "outstanding" SKU set from Supabase AND asks Shopify directly which
// variants currently carry the custom.restock_eta metafield, then diffs the two
// sets live. That makes it safe to call from a serverless function on any
// instance, at any time, with no shared disk between invocations.
//
// Server-only. Never import this module (or the token/credentials it reads)
// from a client component.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

function shopDomain(): string {
    return process.env.SHOPIFY_STORE_DOMAIN || "";
}

function credentialsConfigured(): boolean {
    return Boolean(
          shopDomain() && process.env.SHOPIFY_RESTOCK_CLIENT_ID && process.env.SHOPIFY_RESTOCK_CLIENT_SECRET
        );
}

/**
 * Fetches a fresh Admin API access token via the OAuth client_credentials grant.
 * The token is used only for the lifetime of this request and is never written
 * to disk, a database, or any cache — it must be re-fetched on every sync.
 */
async function getShopifyToken(): Promise<string> {
    const clientId = process.env.SHOPIFY_RESTOCK_CLIENT_ID || "";
    const clientSecret = process.env.SHOPIFY_RESTOCK_CLIENT_SECRET || "";
    const res = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
                  grant_type: "client_credentials",
                  client_id: clientId,
                  client_secret: clientSecret,
          }),
    });
    if (!res.ok) {
          throw new Error(`Shopify OAuth token request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error("Shopify OAuth response did not include an access_token.");
    return json.access_token;
}

interface GraphQLResponse<T> {
    data?: T;
    errors?: unknown;
}

/** Minimal Admin GraphQL client with one retry on 429 (rate limit). */
async function shopifyGraphQL<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = `https://${shopDomain()}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
    for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch(url, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
                  body: JSON.stringify({ query, variables: variables ?? {} }),
          });
          if (res.status === 429 && attempt === 0) {
                  const retryAfter = Number(res.headers.get("Retry-After") || "1");
                  await new Promise((r) => setTimeout(r, Math.min(Math.max(retryAfter, 1), 5) * 1000));
                  continue;
          }
          if (!res.ok) {
                  throw new Error(`Shopify GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
          }
          const json = (await res.json()) as GraphQLResponse<T>;
          if (json.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 500)}`);
          return json.data as T;
    }
    throw new Error("Shopify GraphQL request was rate-limited twice in a row.");
}

// ── Supabase: outstanding pending shipments, grouped by SKU ────────────────────

interface ImpoRow {
    id: string;
    eta: string | null;
    status: string;
}

interface ImpoLineRow {
    impo_id: string;
    item_code: string;
    qty_incoming: number;
    qty_received: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows<T>(svc: any, table: string, select: string, pageSize = 1000): Promise<T[]> {
    const rows: T[] = [];
    let from = 0;
    for (;;) {
          const { data, error } = await svc.from(table).select(select).range(from, from + pageSize - 1);
          if (error) throw new Error(`Supabase "${table}" query failed: ${error.message}`);
          const batch = (data ?? []) as T[];
          rows.push(...batch);
          if (batch.length < pageSize) break;
          from += pageSize;
    }
    return rows;
}

/**
 * Earliest ETA per SKU, for impo_lines that belong to a still-"pending" impo AND
 * are not yet fully received (qty_received < qty_incoming). Lines with no ETA
 * set yet on their impo are skipped — there's nothing to write to Shopify until
 * Grace sets a date.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOutstandingEtaBySku(svc: any): Promise<Map<string, string>> {
    const [impos, lines] = await Promise.all([
          fetchAllRows<ImpoRow>(svc, "impos", "id,eta,status"),
          fetchAllRows<ImpoLineRow>(svc, "impo_lines", "impo_id,item_code,qty_incoming,qty_received"),
        ]);
    const impoById = new Map(impos.map((i) => [i.id, i]));
    const earliest = new Map<string, string>();
    for (const line of lines) {
          const impo = impoById.get(line.impo_id);
          if (!impo || impo.status !== "pending" || !impo.eta) continue;
          const received = line.qty_received ?? 0;
          if (received >= (line.qty_incoming ?? 0)) continue;
          const current = earliest.get(line.item_code);
          if (!current || impo.eta < current) earliest.set(line.item_code, impo.eta);
    }
    return earliest;
}

// ── Shopify: variant lookup, metafield definition, bulk mutations ──────────────

interface VariantNode {
    id: string;
    sku: string;
    inventoryQuantity: number;
    product: { id: string };
    metafield: { id: string; value: string } | null;
}

const VARIANT_BY_SKU_QUERY = `
  query VariantBySku($query: String!) {
      productVariants(first: 5, query: $query) {
            nodes {
                    id
                            sku
                                    inventoryQuantity
                                            product { id }
                                                    metafield(namespace: "custom", key: "restock_eta") { id value }
                                                          }
                                                              }
                                                                }
                                                                `;

async function findVariantBySku(token: string, sku: string): Promise<VariantNode | null> {
    const data = await shopifyGraphQL<{ productVariants: { nodes: VariantNode[] } }>(
          token,
          VARIANT_BY_SKU_QUERY,
      { query: `sku:${sku}` }
        );
    const nodes = data.productVariants?.nodes ?? [];
    // Shopify's `sku:` search can return near-matches; require an exact match.
  return nodes.find((n) => n.sku === sku) ?? null;
}

// Marking the definition adminFilterable lets us later query
// `metafields.custom.restock_eta:*` to find every variant currently flagged,
// which is what makes the stale-clearing pass stateless (no local JSON file).
const DEFINITION_UPSERT_MUTATION = `
  mutation EnsureRestockEtaDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id }
                  userErrors { field message code }
                      }
                        }
                        `;

async function ensureMetafieldDefinition(token: string): Promise<void> {
    await shopifyGraphQL(token, DEFINITION_UPSERT_MUTATION, {
          definition: {
                  name: "Restock ETA",
                  namespace: "custom",
                  key: "restock_eta",
                  type: "date",
                  ownerType: "PRODUCTVARIANT",
                  description: "Expected restock date, synced from incoming-shipment tracking. Estimate only.",
                  capabilities: { adminFilterable: { enabled: true } },
          },
    });
    // userErrors here is expected/benign once the definition exists (code "TAKEN")
  // — we don't fail the sync over it, the definition only needs to exist once.
}

const VARIANTS_WITH_RESTOCK_ETA_QUERY = `
  query VariantsWithRestockEta($cursor: String) {
      productVariants(first: 100, after: $cursor, query: "metafields.custom.restock_eta:*") {
            pageInfo { hasNextPage endCursor }
                  nodes {
                          id
                                  sku
                                          inventoryQuantity
                                                  product { id }
                                                          metafield(namespace: "custom", key: "restock_eta") { id value }
                                                                }
                                                                    }
                                                                      }
                                                                      `;

/**
 * Every variant that currently carries a custom.restock_eta value, fetched
 * fresh from Shopify (not from any local record of what we previously wrote).
 * Relies on the metafield definition being adminFilterable (ensured above).
 */
async function fetchVariantsWithRestockEta(token: string): Promise<VariantNode[]> {
    const results: VariantNode[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
          const data = await shopifyGraphQL<{
                  productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: VariantNode[] };
          }>(token, VARIANTS_WITH_RESTOCK_ETA_QUERY, { cursor });
          results.push(...(data.productVariants?.nodes ?? []));
          if (!data.productVariants?.pageInfo?.hasNextPage) break;
          cursor = data.productVariants.pageInfo.endCursor;
    }
    return results;
}

interface BulkVariantInput {
    id: string;
    inventoryPolicy: "CONTINUE" | "DENY";
    metafields?: { namespace: string; key: string; value: string }[];
}

const BULK_UPDATE_MUTATION = `
  mutation RestockEtaBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id sku inventoryPolicy }
                  userErrors { field message }
                      }
                        }
                        `;

interface BulkUpdateResult {
    productVariantsBulkUpdate: {
          productVariants: { id: string; sku: string; inventoryPolicy: string }[];
          userErrors: { field: string[]; message: string }[];
    };
}

async function bulkUpdateVariants(token: string, productId: string, variants: BulkVariantInput[]) {
    return shopifyGraphQL<BulkUpdateResult>(token, BULK_UPDATE_MUTATION, { productId, variants });
}

const DELETE_METAFIELDS_MUTATION = `
  mutation RestockEtaDelete($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
            deletedMetafields { key ownerId }
                  userErrors { field message }
                      }
                        }
                        `;

interface DeleteMetafieldsResult {
    metafieldsDelete: {
          deletedMetafields: { key: string; ownerId: string }[];
          userErrors: { field: string[]; message: string }[];
    };
}

async function deleteRestockEtaMetafields(token: string, variantIds: string[]) {
    return shopifyGraphQL<DeleteMetafieldsResult>(token, DELETE_METAFIELDS_MUTATION, {
          metafields: variantIds.map((id) => ({ ownerId: id, namespace: "custom", key: "restock_eta" })),
    });
}

// ── POST — run the sync ─────────────────────────────────────────────────────────

interface SyncErrorEntry {
    scope: string;
    message: string;
}

export async function POST(request: Request): Promise<Response> {
    const auth = await authorizeStockReservation(request, true);
    if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  if (!credentialsConfigured()) {
        return Response.json(
          { ok: false, error: "Shopify restock-sync is not configured on the server (missing env vars)." },
          { status: 500 }
              );
  }

  const svc = auth.serviceClient;
    const errors: SyncErrorEntry[] = [];

  let token: string;
    try {
          token = await getShopifyToken();
    } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : "Failed to authenticate with Shopify." },
            { status: 502 }
                );
    }

  try {
        await ensureMetafieldDefinition(token);
  } catch (e) {
        errors.push({ scope: "metafield_definition", message: e instanceof Error ? e.message : String(e) });
  }

  const outstanding = await fetchOutstandingEtaBySku(svc);

  // updatesByProduct accumulates BOTH "set" and "revert" variant inputs, keyed
  // by product id, so each product only needs one productVariantsBulkUpdate call.
  const updatesByProduct = new Map<string, BulkVariantInput[]>();
    const matchedVariantIds = new Set<string>();
    let updated = 0;

  for (const [sku, eta] of outstanding) {
        let variant: VariantNode | null = null;
        try {
                variant = await findVariantBySku(token, sku);
        } catch (e) {
                errors.push({ scope: `lookup:${sku}`, message: e instanceof Error ? e.message : String(e) });
                continue;
        }
        if (!variant || variant.inventoryQuantity > 0) continue; // in-stock — leave alone

      matchedVariantIds.add(variant.id);
        if (variant.metafield?.value === eta) continue; // idempotent — already correct

      const list = updatesByProduct.get(variant.product.id) ?? [];
        list.push({
                id: variant.id,
                inventoryPolicy: "CONTINUE",
                metafields: [{ namespace: "custom", key: "restock_eta", value: eta }],
        });
        updatesByProduct.set(variant.product.id, list);
        updated += 1;
  }

  // Stale pass: variants Shopify says currently carry the metafield, but whose
  // SKU is no longer in the outstanding set above (shipment received/cancelled).
  let staleVariantIds: string[] = [];
    try {
          const flagged = await fetchVariantsWithRestockEta(token);
          for (const v of flagged) {
                  if (matchedVariantIds.has(v.id)) continue;
                  staleVariantIds.push(v.id);
                  const list = updatesByProduct.get(v.product.id) ?? [];
                  list.push({ id: v.id, inventoryPolicy: "DENY" });
                  updatesByProduct.set(v.product.id, list);
          }
    } catch (e) {
          errors.push({ scope: "stale_lookup", message: e instanceof Error ? e.message : String(e) });
    }

  for (const [productId, variants] of updatesByProduct) {
        try {
                const result = await bulkUpdateVariants(token, productId, variants);
                const userErrors = result.productVariantsBulkUpdate?.userErrors ?? [];
                for (const ue of userErrors) errors.push({ scope: `update:${productId}`, message: ue.message });
        } catch (e) {
                errors.push({ scope: `update:${productId}`, message: e instanceof Error ? e.message : String(e) });
        }
  }

  if (staleVariantIds.length) {
        try {
                const result = await deleteRestockEtaMetafields(token, staleVariantIds);
                const userErrors = result.metafieldsDelete?.userErrors ?? [];
                for (const ue of userErrors) errors.push({ scope: "metafieldsDelete", message: ue.message });
        } catch (e) {
                errors.push({ scope: "metafieldsDelete", message: e instanceof Error ? e.message : String(e) });
        }
  }

  return Response.json({
        ok: true,
        updated,
        cleared: staleVariantIds.length,
        outstandingSkuCount: outstanding.size,
        errors,
  });
}
