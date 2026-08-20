import { createClient } from "@supabase/supabase-js";

import { isManager } from "@/lib/permissions";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Module-level token cache — valid for a single serverless instance lifetime. */
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return false;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return false;
  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await svc
    .from("users")
    .select("role, portal_access")
    .eq("id", data.user.id)
    .maybeSingle();
  const profile = {
    id: data.user.id,
    role: (row as { role?: string } | null)?.role ?? null,
    portal_access:
      (row as { portal_access?: string[] | null } | null)?.portal_access ?? null,
  } as UserProfile;
  return isManager(profile);
}

function acsysConfigured(): boolean {
  return !!(
    process.env.ACSYS_BASE_URL &&
    process.env.ACSYS_CID &&
    process.env.ACSYS_USERNAME &&
    process.env.ACSYS_PASSWORD
  );
}

async function getAcsysToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const base = (process.env.ACSYS_BASE_URL ?? "").replace(/\/$/, "");
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cid: Number(process.env.ACSYS_CID),
      username: process.env.ACSYS_USERNAME,
      password: process.env.ACSYS_PASSWORD,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`acSysERP login failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { token: string; expiresIn: number };
  cachedToken = json.token;
  // Refresh 60 s before actual expiry
  tokenExpiresAt = now + (json.expiresIn - 60) * 1000;
  return json.token;
}

interface AcsysItem {
  itemCode: string;
  itemDesc: string;
  unit: string;
  price: number;
  priceType: string;
  taxcode: string;
  taxPercentage: number;
  stockQty: number;
  isActive: boolean;
}

interface AcsysStockRow {
  itemCode: string;
  warehouseCode: string;
  availableQty: number;
  reservedQty: number;
  onOrderQty: number;
}

export interface CatalogItem {
  itemCode: string;
  itemDesc: string;
  unit: string;
  price: number;
  priceType: string;
  taxCode: string;
  taxPct: number;
  stockQty: number;
  availableQty: number;
  reservedQty: number;
  onOrderQty: number;
}

async function fetchAllPages<T>(
  url: string,
  token: string,
  pageSize = 200
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  const MAX_PAGES = 10;

  while (page <= MAX_PAGES) {
    const sep = url.includes("?") ? "&" : "?";
    const pageUrl = `${url}${sep}PageNumber=${page}&PageSize=${pageSize}`;
    const res = await fetch(pageUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const json = (await res.json()) as {
      success: boolean;
      data: T[];
      paging?: { totalPages: number };
    };
    if (!json.success || !Array.isArray(json.data)) break;
    results.push(...json.data);
    if (!json.paging || page >= json.paging.totalPages) break;
    page++;
  }
  return results;
}

export async function GET(request: Request): Promise<Response> {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  if (!acsysConfigured()) {
    return Response.json({ ok: true, configured: false, items: [] });
  }

  try {
    const token = await getAcsysToken();
    const base = (process.env.ACSYS_BASE_URL ?? "").replace(/\/$/, "");
    const cid = process.env.ACSYS_CID!;

    const [rawItems, rawStock] = await Promise.all([
      fetchAllPages<AcsysItem>(`${base}/api/v1/items?CID=${cid}`, token),
      fetchAllPages<AcsysStockRow>(`${base}/api/v1/stock?CID=${cid}`, token),
    ]);

    // Aggregate stock by itemCode across all warehouses
    const stockMap = new Map<string, { available: number; reserved: number; onOrder: number }>();
    for (const s of rawStock) {
      const code = s.itemCode.toUpperCase();
      const prev = stockMap.get(code) ?? { available: 0, reserved: 0, onOrder: 0 };
      stockMap.set(code, {
        available: prev.available + (s.availableQty ?? 0),
        reserved: prev.reserved + (s.reservedQty ?? 0),
        onOrder: prev.onOrder + (s.onOrderQty ?? 0),
      });
    }

    const items: CatalogItem[] = rawItems
      .filter((i) => i.isActive)
      .map((i) => {
        const stock = stockMap.get(i.itemCode.toUpperCase());
        return {
          itemCode: i.itemCode,
          itemDesc: i.itemDesc,
          unit: i.unit,
          price: i.price,
          priceType: i.priceType,
          taxCode: i.taxcode,
          taxPct: i.taxPercentage,
          stockQty: i.stockQty,
          availableQty: stock?.available ?? i.stockQty,
          reservedQty: stock?.reserved ?? 0,
          onOrderQty: stock?.onOrder ?? 0,
        };
      });

    return Response.json({ ok: true, configured: true, items });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "acSysERP request failed.",
      },
      { status: 502 }
    );
  }
}
