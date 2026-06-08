import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/types";

import type { CaptureEngine, LpDraft } from "./parseTypes";

/** Supabase Storage bucket holding the original LP (LPO) PDFs. */
const BUCKET = "lp-invoices";

/** Send a PDF to the server parse endpoint (auto-capture). No DB write. */
export async function parseLpViaApi(
  file: File
): Promise<{ draft: LpDraft; engine: CaptureEngine }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in to upload an LP.");

  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/lp/parse", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = (await res.json()) as {
    ok?: boolean;
    draft?: LpDraft;
    engine?: CaptureEngine;
    error?: string;
  };
  if (!res.ok || !json.ok || !json.draft) {
    throw new Error(json.error ?? "Failed to read the LP.");
  }
  return { draft: json.draft, engine: json.engine ?? "basic" };
}

/** Selectable sales entities; "Other" reveals a free-text name field. */
export const ENTITY_OPTIONS = ["Al Shoala", "SLM", "HQ", "MM", "CNL", "Other"] as const;
export type EntityOption = (typeof ENTITY_OPTIONS)[number];

export type LpSaleRow = Tables<"lp_sales">;

/* ------------------------------ PDF storage ----------------------------- */

/** Upload the original LP PDF to storage; returns the stored object path. */
export async function uploadLpPdf(file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `lpos/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);
  return path;
}

/** A short-lived signed URL for a stored LP PDF (inline view or forced download). */
export async function lpPdfUrl(path: string, downloadName?: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600, downloadName ? { download: downloadName } : undefined);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export interface StoredLpPdf {
  name: string;
  path: string;
  createdAt: string | null;
  sizeBytes: number | null;
}

/** List all stored LP PDFs (newest first) for the browse/download UI. */
export async function listLpPdfs(): Promise<StoredLpPdf[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list("lpos", { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((f) => !!f.name && !f.name.endsWith("/"))
    .map((f) => ({
      name: f.name,
      path: `lpos/${f.name}`,
      createdAt: f.created_at ?? null,
      sizeBytes: (f.metadata as { size?: number } | null)?.size ?? null,
    }));
}

/* ------------------------------ Save an LP ------------------------------ */

export interface VerifiedLpLine {
  lineNumber: number | null;
  brand: string | null;
  modelNo: string;
  description: string | null;
  qtyPurchased: number;
  qtyOriginal: number | null;
  qtyAdjustComment: string | null;
  unitPrice: number | null;
  amount: number | null;
  discAmount: number | null;
}

export interface SaveLpInput {
  lpNumber: string;
  lpDate: string;
  goodsReceivedDate: string | null; // when stock arrived; defaults to lpDate if blank
  vendorName: string;
  vendorTrn: string | null;
  consigneeTrn: string | null;
  qtnRef: string | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  netAmount: number | null;
  terms: string | null;
  notes: string | null;
  pdfPath: string | null;
  createdBy: string;
  lineItems: VerifiedLpLine[];
}

/**
 * Persist a verified LP: one `lp_orders` header + one `lp_items` row per line.
 * Returns the number of line items saved.
 */
export async function saveVerifiedLp(input: SaveLpInput): Promise<number> {
  if (input.lineItems.length === 0) {
    throw new Error("Add at least one line item before saving.");
  }

  const orderPayload: TablesInsert<"lp_orders"> = {
    lp_number: input.lpNumber,
    lp_date: input.lpDate,
    goods_received_date: input.goodsReceivedDate || input.lpDate,
    vendor_name: input.vendorName,
    vendor_trn: input.vendorTrn,
    consignee_trn: input.consigneeTrn,
    qtn_ref: input.qtnRef,
    amount_before_vat: input.amountBeforeVat,
    vat_amount: input.vatAmount,
    net_amount: input.netAmount,
    terms: input.terms,
    notes: input.notes,
    pdf_url: input.pdfPath,
    source: "pdf_upload",
    created_by: input.createdBy,
  };

  const { data: order, error: orderErr } = await supabase
    .from("lp_orders")
    .insert(orderPayload)
    .select("id")
    .single();
  if (orderErr) throw new Error(orderErr.message);
  if (!order) throw new Error("Failed to create the LP header.");

  const rows: TablesInsert<"lp_items">[] = input.lineItems.map((li) => ({
    lp_id: order.id,
    line_number: li.lineNumber,
    brand: li.brand,
    model_no: li.modelNo,
    sku: li.modelNo,
    description: li.description,
    qty_purchased: li.qtyPurchased,
    qty_original: li.qtyOriginal ?? li.qtyPurchased,
    qty_adjust_comment: li.qtyAdjustComment,
    unit_price: li.unitPrice,
    amount: li.amount,
    disc_amount: li.discAmount ?? 0,
    status: "open",
  }));

  const { error: itemsErr } = await supabase.from("lp_items").insert(rows);
  if (itemsErr) throw new Error(itemsErr.message);
  return rows.length;
}

/* ----------------------------- Record a sale ---------------------------- */

export interface RecordSaleInput {
  lpItemId: string;
  soldQty: number;
  invoiceNumber: string | null;
  entity: EntityOption | null;
  entityOther: string | null;
  salesmanName: string | null;
  saleDate: string | null;
  notes: string | null;
  recordedBy: string;
}

/**
 * Record a sale against an LP line, then close the line if nothing remains.
 * Reads `qty_remaining` from the view after insert so the status reflects the
 * full sale history (not just this one entry).
 */
export async function recordSale(input: RecordSaleInput): Promise<void> {
  if (!Number.isFinite(input.soldQty) || input.soldQty <= 0) {
    throw new Error("Sold quantity must be a positive number.");
  }

  // Re-read the CURRENT remaining at save time (the form's number may be stale
  // if another sale landed first) and reject an over-sale. Fail closed: if the
  // line can't be read, do not insert.
  const { data: current, error: readErr } = await supabase
    .from("lp_items_view")
    .select("qty_remaining")
    .eq("id", input.lpItemId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const available = current?.qty_remaining ?? null;
  if (available === null) {
    throw new Error("Could not verify the remaining quantity for this line.");
  }
  if (input.soldQty > available) {
    throw new Error(
      `Only ${available} remaining — you can record at most ${available}.`
    );
  }

  const salePayload: TablesInsert<"lp_sales"> = {
    lp_item_id: input.lpItemId,
    sold_qty: input.soldQty,
    invoice_number: input.invoiceNumber,
    entity: input.entity,
    entity_other: input.entity === "Other" ? input.entityOther : null,
    salesman_name: input.salesmanName,
    sale_date: input.saleDate,
    notes: input.notes,
    recorded_by: input.recordedBy,
  };
  const { error } = await supabase.from("lp_sales").insert(salePayload);
  if (error) throw new Error(error.message);

  // Recompute remaining from the view and close the line when fully sold.
  const { data: view } = await supabase
    .from("lp_items_view")
    .select("qty_remaining")
    .eq("id", input.lpItemId)
    .maybeSingle();
  const remaining = view?.qty_remaining ?? null;
  if (remaining !== null) {
    const patch: TablesUpdate<"lp_items"> = {
      status: remaining <= 0 ? "cleared" : "open",
      updated_at: new Date().toISOString(),
    };
    await supabase.from("lp_items").update(patch).eq("id", input.lpItemId);
  }
}

/** Sale history for one LP line, newest first. */
export async function fetchSaleHistory(lpItemId: string): Promise<LpSaleRow[]> {
  const { data, error } = await supabase
    .from("lp_sales")
    .select("*")
    .eq("lp_item_id", lpItemId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* --------------------------- Manager edit a line ------------------------ */

export interface EditLpItemInput {
  id: string;
  brand: string | null;
  modelNo: string;
  description: string | null;
  qtyPurchased: number;
  qtyAdjustComment: string | null;
  unitPrice: number | null;
  amount: number | null;
  discAmount: number | null;
}

/** Manager-only edit of a saved LP line. */
export async function updateLpItem(input: EditLpItemInput): Promise<void> {
  const patch: TablesUpdate<"lp_items"> = {
    brand: input.brand,
    model_no: input.modelNo,
    sku: input.modelNo,
    description: input.description,
    qty_purchased: input.qtyPurchased,
    qty_adjust_comment: input.qtyAdjustComment,
    unit_price: input.unitPrice,
    amount: input.amount,
    disc_amount: input.discAmount,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("lp_items")
    .update(patch)
    .eq("id", input.id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Update affected no rows.");
}

/**
 * Set/clear an LPO's Goods Received Date — ageing counts from this (falling back
 * to the LP date when null). Any LP-Tracker user may set it.
 */
export async function setGoodsReceivedDate(lpId: string, dateIso: string | null): Promise<void> {
  const patch: TablesUpdate<"lp_orders"> = {
    goods_received_date: dateIso || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("lp_orders")
    .update(patch)
    .eq("id", lpId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Update affected no rows.");
}
