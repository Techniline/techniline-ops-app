import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert } from "@/lib/types";

export type ReturnRow = Tables<"marketplace_returns">;

export interface ReturnItem {
  sku: string | null;
  product: string | null;
  qty: number | null;
  condition: string | null;
}

export interface AuditEntry {
  id: string;
  return_id: string;
  action: string;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
  snapshot: unknown;
}

/** Product lines for a return — from the `items` array, falling back to the
 *  legacy single header fields for older records. */
export function readItems(r: Pick<ReturnRow, "items" | "sku" | "product" | "qty" | "condition">): ReturnItem[] {
  const raw = r.items;
  if (Array.isArray(raw) && raw.length) {
    return (raw as unknown as ReturnItem[]).map((i) => ({
      sku: i?.sku ?? null,
      product: i?.product ?? null,
      qty: typeof i?.qty === "number" ? i.qty : i?.qty ? Number(i.qty) : null,
      condition: i?.condition ?? null,
    }));
  }
  return [{ sku: r.sku ?? null, product: r.product ?? null, qty: r.qty ?? null, condition: r.condition ?? null }];
}

export function itemCount(r: Pick<ReturnRow, "items">): number {
  return Array.isArray(r.items) ? r.items.length : 1;
}

export const CHANNELS: { value: string; label: string }[] = [
  { value: "amazon_df", label: "Amazon DF" },
  { value: "amazon_seller", label: "Amazon Seller" },
  { value: "amazon_easy_ship", label: "Amazon Easy Ship" },
  { value: "amazon_self_ship", label: "Amazon Self Ship" },
  { value: "amazon_flex", label: "Amazon Flex" },
  { value: "noon", label: "Noon" },
  { value: "cocoblu", label: "Cocoblu" },
];

export const RETURN_REASONS: { value: string; label: string }[] = [
  { value: "customer_return", label: "Customer return" },
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "not_delivered", label: "Not delivered" },
  { value: "other", label: "Other" },
];

export const CONDITIONS: { value: string; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "damaged", label: "Damaged" },
  { value: "opened", label: "Opened" },
  { value: "missing_parts", label: "Missing parts" },
];

export const PHYSICAL_STATUS: { value: string; label: string }[] = [
  { value: "expected", label: "Expected" },
  { value: "received", label: "Received" },
  { value: "inspected", label: "Inspected" },
  { value: "restocked", label: "Restocked" },
  { value: "disposed", label: "Disposed" },
  { value: "issue_hold", label: "Issue / Hold" },
];

export const DOC_STATUS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending docs" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "credited", label: "Credited" },
  { value: "rejected", label: "Rejected" },
  { value: "closed", label: "Closed" },
];

export function rLabel(set: { value: string; label: string }[], v: string | null | undefined): string {
  if (!v) return "—";
  return set.find((o) => o.value === v)?.label ?? v;
}

export interface ReturnFilters {
  channel?: string;
  docPending?: boolean;
  search?: string;
}

export async function fetchReturns(f: ReturnFilters = {}): Promise<ReturnRow[]> {
  let q = supabase.from("marketplace_returns").select("*").order("created_at", { ascending: false }).limit(500);
  if (f.channel) q = q.eq("channel", f.channel);
  if (f.docPending) q = q.in("doc_status", ["pending", "in_progress"]);
  const s = f.search?.trim();
  if (s) {
    const like = `%${s}%`;
    q = q.or(
      [`return_ref.ilike.${like}`, `order_ref.ilike.${like}`, `sku.ilike.${like}`, `asin.ilike.${like}`, `product.ilike.${like}`].join(",")
    );
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function currentUser(): Promise<{ id: string | null; name: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  return { id: user?.id ?? null, name: user?.email ?? null };
}

const RETURN_IMAGE_BUCKET = "return-images";

export async function uploadReturnImages(returnId: string, files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${returnId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from(RETURN_IMAGE_BUCKET).upload(path, file);
    if (error) throw new Error(`Image upload failed: ${error.message}`);
    const { data } = supabase.storage.from(RETURN_IMAGE_BUCKET).getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}

export async function fetchAuditLog(returnId: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("marketplace_returns_audit")
    .select("*")
    .eq("return_id", returnId)
    .order("changed_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditEntry[];
}

/** Create or update a return. Stamps logged_by/logged_by_name on creation and writes an audit entry. */
export async function saveReturn(row: Partial<ReturnRow> & { id?: string }): Promise<ReturnRow> {
  const isNew = !row.id;
  const { id: me, name: meName } = await currentUser();
  const payload = {
    ...row,
    logged_by: row.logged_by ?? (isNew ? me : undefined),
    logged_by_name: row.logged_by_name ?? (isNew ? meName : undefined),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"marketplace_returns">;
  const { data, error } = await supabase.from("marketplace_returns").upsert(payload).select("*").single();
  if (error) throw new Error(error.message);
  void supabase.from("marketplace_returns_audit").insert({
    return_id: data.id,
    action: isNew ? "created" : "updated",
    changed_by: me,
    changed_by_name: meName,
    snapshot: data,
  });
  return data;
}

/** Update the documentation section (Maricel); stamps documented_by and writes an audit entry. */
export async function saveReturnDocs(id: string, patch: Partial<ReturnRow>): Promise<void> {
  const { id: me, name: meName } = await currentUser();
  const { error } = await supabase
    .from("marketplace_returns")
    .update({ ...patch, documented_by: me, documented_by_name: meName, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  void supabase.from("marketplace_returns_audit").insert({
    return_id: id,
    action: "updated",
    changed_by: me,
    changed_by_name: meName,
    snapshot: { id, ...patch },
  });
}

export interface ReturnImportSummary {
  returnRows: number;
  byChannel: Record<string, number>;
  willInsert: number;
  alreadyExists: number;
  sample: { channel: string; order_ref: string; sku: string | null; received_date: string | null }[];
}

/** Upload the Amazon delivery list and preview (apply=false) or log (apply=true)
 *  its return rows into marketplace_returns, channelled by sheet. */
export async function importAmazonReturns(
  file: File,
  apply: boolean
): Promise<{ dryRun: boolean; inserted?: number; summary: ReturnImportSummary }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/logistics/import-amazon-returns?apply=${apply ? "1" : "0"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.ok !== true) throw new Error((j.error as string) ?? `HTTP ${res.status}`);
  return { dryRun: !!j.dryRun, inserted: j.inserted as number | undefined, summary: j.summary as ReturnImportSummary };
}

export interface ReturnSyncResult {
  updated: number;
  created: number;
}

/** Backfill product names + create new return records from SP-API finance data. */
export async function syncReturnsFromAmazon(): Promise<ReturnSyncResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/spapi/returns-sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.ok !== true) throw new Error((j.error as string) ?? `HTTP ${res.status}`);
  return { updated: (j.updated as number) ?? 0, created: (j.created as number) ?? 0 };
}

// ─── Amazon Returns XML import ────────────────────────────────────────────────

export interface XmlReturnRow {
  return_ref: string | null;
  order_ref: string;
  sku: string | null;
  product: string | null;
  asin: string | null;
  qty: number;
  received_date: string | null;
  reason: string | null;
  tracking_number: string | null;
  channel: string;
  return_status: string;
}

const XML_REASON_MAP: Record<string, string> = {
  "CR-ORDERED_WRONG_ITEM": "wrong_item",
  "CR-DEFECTIVE": "damaged",
  "CR-QUALITY_UNACCEPTABLE": "damaged",
  "CR-MISSING_PARTS": "other",
  "CR-DAMAGED_BY_CARRIER": "damaged",
  "CR-DAMAGED_BY_FC": "damaged",
  "CR-UNWANTED_ITEM": "customer_return",
  "CR-NOT_COMPATIBLE": "other",
  "CR-MISSED_ESTIMATED_DELIVERY": "not_delivered",
  "AMZ-PG-BAD-DESC": "other",
};

/** Parse Amazon Returns Report XML (client-side). Returns one entry per return_details block. */
export function parseReturnsXml(xmlText: string): XmlReturnRow[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) return [];

  const get = (el: Element, tag: string) => el.querySelector(tag)?.textContent?.trim() ?? null;

  return Array.from(doc.querySelectorAll("return_details")).flatMap((rd) => {
    const orderId = get(rd, "order_id");
    if (!orderId) return [];

    const carrier = get(rd, "return_carrier");
    const channel = carrier === "AMZAE" ? "amazon_easy_ship" : "amazon_easy_ship";

    const reasonCode = get(rd, "return_reason_code");
    const reason = reasonCode ? (XML_REASON_MAP[reasonCode] ?? "other") : null;

    const requestDate = get(rd, "return_request_date");
    const receivedDate = requestDate ? requestDate.slice(0, 10) : null;

    return [{
      return_ref: get(rd, "amazon_rma_id"),
      order_ref: orderId,
      sku: get(rd, "merchant_sku"),
      product: get(rd, "item_name"),
      asin: get(rd, "asin"),
      qty: parseInt(get(rd, "return_quantity") ?? "1") || 1,
      received_date: receivedDate,
      reason,
      tracking_number: get(rd, "tracking_id"),
      channel,
      return_status: get(rd, "return_request_status") ?? "",
    }];
  });
}

export interface XmlImportPreview {
  willInsert: number;
  willUpdate: number;
  alreadyExists: number;
}

export interface XmlImportResult extends XmlImportPreview {
  inserted: number;
  updated: number;
}

/** Preview or apply an import of parsed XML return records.
 *  Deduplication: by return_ref first; then by order_ref for records without a return_ref. */
export async function importReturnsXml(
  records: XmlReturnRow[],
  apply: boolean
): Promise<XmlImportResult> {
  if (records.length === 0) return { willInsert: 0, willUpdate: 0, alreadyExists: 0, inserted: 0, updated: 0 };

  const returnRefs = records.map((r) => r.return_ref).filter(Boolean) as string[];
  const orderRefs = [...new Set(records.map((r) => r.order_ref))];

  const [refRes, orderRes] = await Promise.all([
    returnRefs.length
      ? supabase.from("marketplace_returns").select("id, return_ref").in("return_ref", returnRefs)
      : Promise.resolve({ data: [] as { id: string; return_ref: string | null }[] }),
    supabase.from("marketplace_returns").select("id, order_ref, return_ref").in("order_ref", orderRefs),
  ]);

  const existingRefSet = new Set(
    ((refRes.data ?? []) as { return_ref: string | null }[]).map((r) => r.return_ref ?? "")
  );
  const existingOrderMap = new Map<string, { id: string; return_ref: string | null }>();
  for (const r of (orderRes.data ?? []) as { id: string; order_ref: string | null; return_ref: string | null }[]) {
    if (r.order_ref) existingOrderMap.set(r.order_ref, { id: r.id, return_ref: r.return_ref });
  }

  let willInsert = 0, willUpdate = 0, alreadyExists = 0;
  const toInsert: XmlReturnRow[] = [];
  const toUpdate: { id: string; record: XmlReturnRow }[] = [];

  for (const record of records) {
    if (record.return_ref && existingRefSet.has(record.return_ref)) {
      alreadyExists++;
      continue;
    }
    const existing = existingOrderMap.get(record.order_ref);
    if (existing) {
      if (!existing.return_ref && record.return_ref) {
        willUpdate++;
        toUpdate.push({ id: existing.id, record });
      } else {
        alreadyExists++;
      }
      continue;
    }
    willInsert++;
    toInsert.push(record);
  }

  let inserted = 0, updated = 0;

  if (apply) {
    for (const r of toInsert) {
      const { error } = await supabase.from("marketplace_returns").insert({
        channel: r.channel,
        order_ref: r.order_ref,
        return_ref: r.return_ref,
        sku: r.sku,
        product: r.product,
        asin: r.asin,
        qty: r.qty,
        received_date: r.received_date,
        reason: r.reason,
        tracking_number: r.tracking_number,
        physical_status: "received",
        doc_status: "pending",
        items: [{ sku: r.sku, product: r.product, qty: r.qty, condition: null }],
        logged_by_name: "Amazon Returns XML import",
      });
      if (!error) inserted++;
    }

    for (const { id, record } of toUpdate) {
      const { error } = await supabase.from("marketplace_returns").update({
        return_ref: record.return_ref,
        ...(record.reason ? { reason: record.reason } : {}),
        ...(record.tracking_number ? { tracking_number: record.tracking_number } : {}),
        ...(record.received_date ? { received_date: record.received_date } : {}),
        ...(record.product ? { product: record.product } : {}),
        ...(record.asin ? { asin: record.asin } : {}),
      }).eq("id", id);
      if (!error) updated++;
    }
  }

  return { willInsert, willUpdate, alreadyExists, inserted, updated };
}

export async function deleteReturn(id: string): Promise<void> {
  const { error } = await supabase.from("marketplace_returns").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Count of returns still needing documentation (Maricel's queue badge). */
export async function docsPendingCount(): Promise<number> {
  const { count } = await supabase
    .from("marketplace_returns")
    .select("*", { count: "exact", head: true })
    .in("doc_status", ["pending", "in_progress"]);
  return count ?? 0;
}

function esc(s: unknown): string {
  return String(s ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function returnEmailSubject(r: ReturnRow): string {
  return `Marketplace return – ${rLabel(CHANNELS, r.channel)} – ${r.return_ref ?? r.sku ?? "documentation needed"}`;
}

/** Branded HTML email (matches the PRT email style; Outlook-safe header). */
export function returnEmailHtml(r: ReturnRow): string {
  const row = (label: string, value: string) =>
    `<tr>` +
    `<td style="padding:9px 12px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:13px;font-weight:600;width:150px">${label}</td>` +
    `<td style="padding:9px 12px;border:1px solid #e2e8f0;color:#0f172a;font-size:14px">${value}</td></tr>`;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:28px 24px">
    <table role="presentation" align="center" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px">
      <tr>
        <td bgcolor="#4f46e5" style="background-color:#4f46e5;background-image:linear-gradient(135deg,#6366f1 0%,#4f46e5 45%,#4338ca 100%);padding:26px;border-bottom:3px solid #3730a3;border-radius:14px 14px 0 0">
          <div style="color:#ffffff;font-size:23px;font-weight:700;letter-spacing:0.2px;text-shadow:0 1px 2px rgba(0,0,0,0.3)">Marketplace Return — documentation needed</div>
          <div style="margin-top:9px;color:#dbe1ff;font-size:13px;font-weight:600">${esc(rLabel(CHANNELS, r.channel))} &nbsp;·&nbsp; ${esc(r.return_ref ?? "—")}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 26px 20px">
          <div style="color:#0f172a;font-size:20px;font-weight:700;line-height:1.4;margin-bottom:26px">A return was received in the warehouse and needs documentation:</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0">
            ${row("Channel", esc(rLabel(CHANNELS, r.channel)))}
            ${row("Return ID", esc(r.return_ref ?? "—"))}
            ${row("Order number", esc(r.order_ref ?? "—"))}
            ${row("Reason", esc(rLabel(RETURN_REASONS, r.reason)))}
            ${row("Return date", esc(r.received_date ?? "—"))}
            ${row(
              "Products",
              readItems(r)
                .map(
                  (i) =>
                    `&bull; ${esc(i.product ?? i.sku ?? "—")}${i.sku && i.product ? ` (${esc(i.sku)})` : ""} &times;${esc(i.qty ?? 1)}${
                      i.condition ? ` — ${esc(rLabel(CONDITIONS, i.condition))}` : ""
                    }`
                )
                .join("<br>")
            )}
          </table>
          <p style="margin:22px 0 0;color:#334155;font-size:14px">Please open <strong>Logistics → Marketplace Returns</strong> and complete the documentation (credit note, SRT/PRT, dispute &amp; case IDs).</p>
          <p style="margin:18px 0 0;font-size:14px"><span style="color:#64748b">Techniline Logistics</span></p>
        </td>
      </tr>
    </table>
  </div>`;
}

/** Notify Maricel that a return was logged (server emails her). Best-effort. */
export async function notifyReturnLogged(r: ReturnRow): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  await fetch("/api/logistics/notify-return", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ subject: returnEmailSubject(r), html: returnEmailHtml(r) }),
  }).catch(() => {});
}
