import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert } from "@/lib/types";

export type ReturnRow = Tables<"marketplace_returns">;

export interface ReturnItem {
  sku: string | null;
  product: string | null;
  qty: number | null;
  condition: string | null;
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

async function uid(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Create or update a return. On create, the row defaults to doc_status 'pending'
 *  (Maricel's queue) and the caller triggers the notify email. Returns the row. */
export async function saveReturn(row: Partial<ReturnRow> & { id?: string }): Promise<ReturnRow> {
  const isNew = !row.id;
  const me = await uid();
  const payload = {
    ...row,
    logged_by: row.logged_by ?? (isNew ? me : undefined),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"marketplace_returns">;
  const { data, error } = await supabase.from("marketplace_returns").upsert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

/** Update the documentation section (Maricel); stamps documented_by. */
export async function saveReturnDocs(id: string, patch: Partial<ReturnRow>): Promise<void> {
  const me = await uid();
  const { error } = await supabase
    .from("marketplace_returns")
    .update({ ...patch, documented_by: me, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
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
            ${row("ASIN", esc(r.asin ?? "—"))}
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
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  await fetch("/api/logistics/notify-return", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ subject: returnEmailSubject(r), html: returnEmailHtml(r) }),
  }).catch(() => {});
}
