import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert } from "@/lib/types";

export type ResellerRow = Tables<"reseller_deliveries">;
export type CargoRow = Tables<"cargo_deliveries">;
export type CustomerRow = Tables<"logistics_customers">;
export type DriverRow = Tables<"logistics_drivers">;
export type VehicleRow = Tables<"logistics_vehicles">;
export type PrtRow = Tables<"prt_requests">;
export type ActivityRow = Tables<"logistics_activity_logs">;
export type ApiErrorRow = Tables<"logistics_api_error_logs">;

async function currentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── Reseller deliveries ──────────────────────────────────────────────────────

export interface ParsedDoc {
  docType: "invoice" | "delivery_note" | "other";
  invoiceNumber: string | null;
  doNumber: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
  poNumber: string | null;
  totalValue: number | null;
  items: { sku: string | null; description: string | null; brand: string | null; qty: number | null }[];
  itemsSummary: string;
  engine: "ai" | "basic";
}

/** Upload an invoice OR delivery note PDF and extract a unified draft. */
export async function parseDocPdf(file: File): Promise<ParsedDoc> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/logistics/parse-doc", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; draft?: Omit<ParsedDoc, "itemsSummary"> & { engine: "ai" | "basic" }; error?: string };
  if (!res.ok || !j.ok || !j.draft) throw new Error(j.error ?? `HTTP ${res.status}`);
  const d = j.draft;
  const summary = d.items
    .map((i) => `${i.qty != null ? `${i.qty} × ` : ""}${i.description ?? i.sku ?? ""}${i.sku && i.description ? ` (${i.sku})` : ""}`.trim())
    .filter(Boolean)
    .join("; ");
  return { ...d, itemsSummary: summary };
}

const DOC_BUCKET = "logistics-docs";

/** Upload an invoice/DO PDF to private storage; returns the stored path. */
export async function uploadDeliveryFile(folder: string, kind: "invoice" | "do", file: File): Promise<string> {
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `reseller/${folder}/${kind}-${safe}`;
  const { error } = await supabase.storage
    .from(DOC_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || "application/pdf" });
  if (error) throw new Error(error.message);
  return path;
}

/** Short-lived signed URL to view/download a stored document. */
export async function fileUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

export interface ResellerFilters {
  search?: string; // reseller / invoice / DO / reference
  from?: string;
  to?: string;
  limit?: number;
}

/** Recent reseller deliveries, or matches for the recall filters. */
export async function fetchResellers(filters: ResellerFilters = {}): Promise<ResellerRow[]> {
  let q = supabase.from("reseller_deliveries").select("*").order("created_at", { ascending: false });
  const s = filters.search?.trim();
  if (s) {
    const like = `%${s}%`;
    q = q.or(
      [
        `reseller_name.ilike.${like}`,
        `invoice_number.ilike.${like}`,
        `do_number.ilike.${like}`,
        `reference_no.ilike.${like}`,
      ].join(",")
    );
  }
  if (filters.from) q = q.gte("scheduled_date", filters.from);
  if (filters.to) q = q.lte("scheduled_date", filters.to);
  q = q.limit(filters.limit ?? (s || filters.from || filters.to ? 200 : 25));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface ResellerSuggestions {
  customers: { name: string; contact_person: string | null; phone: string | null; city: string | null; delivery_address: string | null }[];
  drivers: { name: string; phone: string | null }[];
  vehicles: string[];
}

/** Build driver / vehicle / customer suggestion sets from the master tables
 *  (manager-curated, authoritative) merged with past delivery records (for
 *  bootstrap). Master values win. */
export async function fetchResellerSuggestions(): Promise<ResellerSuggestions> {
  const [masterC, masterD, masterV, deliveries] = await Promise.all([
    supabase.from("logistics_customers").select("name, contact_person, phone, city, address").eq("active", true).limit(3000),
    supabase.from("logistics_drivers").select("name, phone").eq("active", true).limit(3000),
    supabase.from("logistics_vehicles").select("plate").eq("active", true).limit(3000),
    supabase
      .from("reseller_deliveries")
      .select("reseller_name, contact_person, phone, city, delivery_address, driver_name, driver_phone, vehicle_number")
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const customers = new Map<string, ResellerSuggestions["customers"][number]>();
  const drivers = new Map<string, { name: string; phone: string | null }>();
  const vehicles = new Set<string>();

  // Seed from master tables first (authoritative).
  for (const c of masterC.data ?? []) {
    const k = (c.name ?? "").trim();
    if (k)
      customers.set(k.toLowerCase(), {
        name: k,
        contact_person: c.contact_person ?? null,
        phone: c.phone ?? null,
        city: c.city ?? null,
        delivery_address: c.address ?? null,
      });
  }
  for (const d of masterD.data ?? []) {
    const k = (d.name ?? "").trim();
    if (k) drivers.set(k.toLowerCase(), { name: k, phone: d.phone ?? null });
  }
  for (const v of masterV.data ?? []) {
    const k = (v.plate ?? "").trim();
    if (k) vehicles.add(k);
  }

  // Merge in anything from history not already covered.
  for (const r of deliveries.data ?? []) {
    const c = (r.reseller_name ?? "").trim();
    if (c && !customers.has(c.toLowerCase())) {
      customers.set(c.toLowerCase(), {
        name: c,
        contact_person: r.contact_person ?? null,
        phone: r.phone ?? null,
        city: r.city ?? null,
        delivery_address: r.delivery_address ?? null,
      });
    }
    const d = (r.driver_name ?? "").trim();
    if (d && !drivers.has(d.toLowerCase())) drivers.set(d.toLowerCase(), { name: d, phone: r.driver_phone ?? null });
    const v = (r.vehicle_number ?? "").trim();
    if (v) vehicles.add(v);
  }
  return { customers: [...customers.values()], drivers: [...drivers.values()], vehicles: [...vehicles] };
}

export async function saveReseller(row: Partial<ResellerRow> & { id?: string }): Promise<void> {
  const uid = row.id ? undefined : await currentUserId();
  const payload: TablesInsert<"reseller_deliveries"> = {
    ...row,
    // On create, stamp who raised the request (and the legacy created_by).
    created_by: uid,
    requested_by: row.id ? row.requested_by ?? undefined : uid,
    updated_at: new Date().toISOString(),
  } as TablesInsert<"reseller_deliveries">;
  const { error } = await supabase.from("reseller_deliveries").upsert(payload);
  if (error) throw new Error(error.message);
  await captureMasters(row); // best-effort: grow the master lists
}

/** Insert any new customer / driver / vehicle names into the master tables
 *  (on conflict do nothing — never overwrites manager-edited details). */
async function captureMasters(d: Partial<ResellerRow>): Promise<void> {
  const tasks: PromiseLike<unknown>[] = [];
  if (d.reseller_name?.trim()) {
    tasks.push(
      supabase.from("logistics_customers").upsert(
        {
          name: d.reseller_name.trim(),
          contact_person: d.contact_person ?? null,
          phone: d.phone ?? null,
          city: d.city ?? null,
          address: d.delivery_address ?? null,
        },
        { onConflict: "name", ignoreDuplicates: true }
      )
    );
  }
  if (d.driver_name?.trim()) {
    tasks.push(
      supabase
        .from("logistics_drivers")
        .upsert({ name: d.driver_name.trim(), phone: d.driver_phone ?? null }, { onConflict: "name", ignoreDuplicates: true })
    );
  }
  if (d.vehicle_number?.trim()) {
    tasks.push(
      supabase.from("logistics_vehicles").upsert({ plate: d.vehicle_number.trim() }, { onConflict: "plate", ignoreDuplicates: true })
    );
  }
  try {
    await Promise.all(tasks);
  } catch {
    /* best-effort; never block the delivery save */
  }
}

// ── Master data (manager/admin manage; team reads) ───────────────────────────

export async function fetchCustomers(): Promise<CustomerRow[]> {
  const { data, error } = await supabase.from("logistics_customers").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function fetchDrivers(): Promise<DriverRow[]> {
  const { data, error } = await supabase.from("logistics_drivers").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function fetchVehicles(): Promise<VehicleRow[]> {
  const { data, error } = await supabase.from("logistics_vehicles").select("*").order("plate");
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function saveCustomer(row: Partial<CustomerRow>): Promise<void> {
  const { error } = await supabase.from("logistics_customers").upsert({ ...row, updated_at: new Date().toISOString() } as never);
  if (error) throw new Error(error.message);
}
export async function saveDriver(row: Partial<DriverRow>): Promise<void> {
  const { error } = await supabase.from("logistics_drivers").upsert({ ...row, updated_at: new Date().toISOString() } as never);
  if (error) throw new Error(error.message);
}
export async function saveVehicle(row: Partial<VehicleRow>): Promise<void> {
  const { error } = await supabase.from("logistics_vehicles").upsert({ ...row, updated_at: new Date().toISOString() } as never);
  if (error) throw new Error(error.message);
}
export async function deleteMaster(kind: "customers" | "drivers" | "vehicles", id: string): Promise<void> {
  const table = kind === "customers" ? "logistics_customers" : kind === "drivers" ? "logistics_drivers" : "logistics_vehicles";
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Quick status change (used by the warehouse to action a request). */
export async function setResellerStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from("reseller_deliveries")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteReseller(id: string): Promise<void> {
  const { error } = await supabase.from("reseller_deliveries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Cargo deliveries ─────────────────────────────────────────────────────────

export async function fetchCargo(): Promise<CargoRow[]> {
  const { data, error } = await supabase
    .from("cargo_deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveCargo(row: Partial<CargoRow> & { id?: string }): Promise<void> {
  const payload: TablesInsert<"cargo_deliveries"> = {
    ...row,
    created_by: row.id ? undefined : await currentUserId(),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"cargo_deliveries">;
  const { error } = await supabase.from("cargo_deliveries").upsert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteCargo(id: string): Promise<void> {
  const { error } = await supabase.from("cargo_deliveries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── PRT requests ─────────────────────────────────────────────────────────────

export async function fetchPrts(): Promise<PrtRow[]> {
  const { data, error } = await supabase
    .from("prt_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function savePrt(row: Partial<PrtRow> & { id?: string }): Promise<PrtRow> {
  const payload: TablesInsert<"prt_requests"> = {
    ...row,
    requested_by: row.requested_by ?? (row.id ? undefined : await currentUserId()),
    updated_at: new Date().toISOString(),
  } as TablesInsert<"prt_requests">;
  const { data, error } = await supabase.from("prt_requests").upsert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

/** Delete a PRT, recording the reason to the activity log first (audit trail). */
export async function deletePrt(p: PrtRow, reason: string): Promise<void> {
  const uid = await currentUserId();
  await supabase.from("logistics_activity_logs").insert({
    entity_type: "prt",
    entity_id: p.id,
    order_number: p.order_number,
    action: "prt_deleted",
    old_value: p.status,
    notes: `Deleted (SKU ${p.sku ?? "—"}): ${reason}`,
    user_id: uid,
  });
  const { error } = await supabase.from("prt_requests").delete().eq("id", p.id);
  if (error) throw new Error(error.message);
}

export async function setPrtStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from("prt_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface PrtSender {
  name: string | null;
  email: string | null;
}

const URGENCY_LABEL: Record<string, string> = {
  normal: "Normal",
  urgent: "Urgent",
  same_day: "Same Day",
  customer_waiting: "Customer Waiting",
};
const LOCATION_LABEL: Record<string, string> = {
  warehouse: "Warehouse",
  hq: "Techniline HQ",
  al_shoala: "Al Shoala Showroom",
  soundline: "Soundline Main / SLM",
  other: "Other",
};
const loc = (v: string | null) => (v ? LOCATION_LABEL[v] ?? v : "—");
const urg = (v: string | null) => (v ? URGENCY_LABEL[v] ?? v : "Normal");

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function prtEmailSubject(p: PrtRow): string {
  return `PRT Request – ${p.sku ?? "—"} – Order ${p.order_number ?? "—"}`;
}

/** Plain-text version (for the Copy button / text fallback). */
export function prtEmailText(p: PrtRow, sender: PrtSender, notes: string): string {
  return [
    "Please arrange the following product transfer:",
    "",
    `Order Number : ${p.order_number ?? "—"}`,
    `Customer     : ${p.customer_name ?? "—"}`,
    `SKU          : ${p.sku ?? "—"}`,
    `Product      : ${p.title ?? "—"}`,
    `Brand        : ${p.brand ?? "—"}`,
    `Quantity     : ${p.qty ?? 1}`,
    `From         : ${loc(p.from_location)}`,
    `To           : ${loc(p.to_location)}`,
    `Required by  : ${p.required_date ?? "—"}`,
    `Urgency      : ${urg(p.urgency)}`,
    notes ? `\nNotes: ${notes}` : "",
    "",
    "Thank you,",
    sender.name || "Techniline Logistics",
    "Techniline Logistics",
    sender.email || "",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

/** Branded HTML email. */
export function prtEmailHtml(p: PrtRow, sender: PrtSender, notes: string): string {
  const urgent = p.urgency === "urgent" || p.urgency === "same_day" || p.urgency === "customer_waiting";
  const chip = `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;${
    urgent ? "background:#fee2e2;color:#b91c1c" : "background:#e0e7ff;color:#4338ca"
  }">${esc(urg(p.urgency))}</span>`;

  const row = (label: string, value: string) =>
    `<tr>` +
    `<td style="padding:9px 12px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:13px;font-weight:600;width:150px">${label}</td>` +
    `<td style="padding:9px 12px;border:1px solid #e2e8f0;color:#0f172a;font-size:14px">${value}</td>` +
    `</tr>`;

  // Header badge: a solid filled pill with white text so it reads cleanly on the
  // indigo bar even in Outlook (where rounded corners are dropped).
  const headChip = `<span style="display:inline-block;padding:6px 14px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#ffffff;${
    urgent ? "background:#ef4444" : "background:rgba(255,255,255,0.22)"
  }">${esc(urg(p.urgency))}</span>`;

  // Table-based + bgcolor fallback so Outlook (Word renderer, ignores gradients)
  // still shows a solid indigo bar with visible white text; modern clients get
  // the gradient + sheen.
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:28px 24px">
    <table role="presentation" align="center" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px">
      <tr>
        <td bgcolor="#4f46e5" style="background-color:#4f46e5;background-image:linear-gradient(135deg,#6366f1 0%,#4f46e5 45%,#4338ca 100%);padding:26px;border-bottom:3px solid #3730a3;border-radius:14px 14px 0 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:top">
                <div style="color:#ffffff;font-size:23px;font-weight:700;letter-spacing:0.2px;text-shadow:0 1px 2px rgba(0,0,0,0.3)">Product Transfer Request</div>
                <div style="margin-top:9px;color:#dbe1ff;font-size:13px;font-weight:600">Order ${esc(p.order_number ?? "—")} &nbsp;·&nbsp; ${esc(p.sku ?? "—")}</div>
              </td>
              <td style="vertical-align:top;text-align:right;white-space:nowrap">${headChip}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 26px 20px">
          <div style="color:#0f172a;font-size:20px;font-weight:700;line-height:1.4;margin-bottom:26px">Please arrange the following product transfer:</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0">
            ${row("Order Number", esc(p.order_number ?? "—"))}
            ${row("Customer", esc(p.customer_name ?? "—"))}
            ${row("SKU", esc(p.sku ?? "—"))}
            ${row("Product", esc(p.title ?? "—"))}
            ${row("Brand", esc(p.brand ?? "—"))}
            ${row("Quantity", esc(p.qty ?? 1))}
            ${row("From", esc(loc(p.from_location)))}
            ${row("To", esc(loc(p.to_location)))}
            ${row("Required by", esc(p.required_date ?? "—"))}
            ${row("Urgency", chip)}
          </table>
          ${
            notes
              ? `<div style="margin-top:18px;padding:12px 14px;background:#f8fafc;border-left:3px solid #cbd5e1;color:#334155;font-size:13px"><strong>Notes:</strong> ${esc(notes)}</div>`
              : ""
          }
          <p style="margin:24px 0 0;color:#334155;font-size:14px">Thank you,</p>
          <p style="margin:2px 0 0;font-size:14px">
            <strong style="color:#0f172a">${esc(sender.name || "Techniline Logistics")}</strong><br>
            <span style="color:#64748b">Techniline Logistics</span>${
              sender.email ? `<br><a style="color:#4f46e5;text-decoration:none" href="mailto:${esc(sender.email)}">${esc(sender.email)}</a>` : ""
            }
          </p>
        </td>
      </tr>
    </table>
  </div>`;
}

/** Send the PRT email via the server (Graph) as the logged-in user. */
export async function sendPrtEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  cc?: string
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  const res = await fetch("/api/logistics/prt-email", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, cc, subject, html, body: text }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
}

// ── Activity log + API errors ────────────────────────────────────────────────

export async function fetchActivity(limit = 200): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from("logistics_activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchApiErrors(limit = 100): Promise<ApiErrorRow[]> {
  const { data, error } = await supabase
    .from("logistics_api_error_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
