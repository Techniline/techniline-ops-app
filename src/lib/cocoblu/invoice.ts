import { supabase } from "@/lib/supabaseClient";

import type { CaptureEngine, InvoiceDraft } from "./invoiceTypes";

/** Supabase Storage bucket holding the original invoice PDFs. */
const BUCKET = "cocoblu-invoices";

/** Send a PDF to the server parse endpoint (auto-capture). No DB write. */
export async function parseInvoiceViaApi(
  file: File
): Promise<{ draft: InvoiceDraft; engine: CaptureEngine }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("You must be signed in to upload an invoice.");

  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/cocoblu/parse", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = (await res.json()) as {
    ok?: boolean;
    draft?: InvoiceDraft;
    engine?: CaptureEngine;
    error?: string;
  };
  if (!res.ok || !json.ok || !json.draft) {
    throw new Error(json.error ?? "Failed to read the invoice.");
  }
  return { draft: json.draft, engine: json.engine ?? "basic" };
}

/** Upload the original PDF to storage; returns the stored object path. */
export async function uploadInvoicePdf(file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `invoices/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);
  return path;
}

/** A short-lived signed URL for viewing a stored invoice PDF. */
export async function invoicePdfUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export interface VerifiedLine {
  sku: string;
  qtySupplied: number;
  qtyRemaining: number;
  unitCost: number | null;
  notes: string | null;
}

export interface SaveVerifiedInvoiceInput {
  invoiceNumber: string;
  invoiceDate: string;
  suppliedDate: string | null;
  pdfPath: string | null;
  verifiedBy: string;
  lineItems: VerifiedLine[];
}

/**
 * Persist a verified invoice: one `cocoblu_ageing` row per line item, tagged
 * with source/pdf/verified-by audit columns. (New columns are cast through
 * `never` until the generated DB types are regenerated post-migration.)
 */
export async function saveVerifiedInvoice(
  input: SaveVerifiedInvoiceInput
): Promise<number> {
  if (input.lineItems.length === 0) {
    throw new Error("Add at least one line item before saving.");
  }
  const nowIso = new Date().toISOString();
  const rows: Record<string, unknown>[] = input.lineItems.map((li) => ({
    invoice_number: input.invoiceNumber,
    invoice_date: input.invoiceDate,
    supplied_date: input.suppliedDate,
    sku: li.sku,
    qty_supplied: li.qtySupplied,
    qty_remaining: li.qtyRemaining,
    unit_cost: li.unitCost,
    notes: li.notes,
    status: li.qtyRemaining === 0 ? "closed" : "open",
    source: "pdf_upload",
    pdf_url: input.pdfPath,
    verified_by: input.verifiedBy,
    verified_at: nowIso,
  }));

  const { error } = await supabase.from("cocoblu_ageing").insert(rows as never);
  if (error) throw new Error(error.message);
  return rows.length;
}

export interface EditRecordInput {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  suppliedDate: string | null;
  sku: string;
  qtySupplied: number;
  qtyRemaining: number;
  unitCost: number | null;
  notes: string | null;
}

/** Manager-only full edit of a saved record. */
export async function updateCocobluRecord(input: EditRecordInput): Promise<void> {
  const payload: Record<string, unknown> = {
    invoice_number: input.invoiceNumber,
    invoice_date: input.invoiceDate,
    supplied_date: input.suppliedDate,
    sku: input.sku,
    qty_supplied: input.qtySupplied,
    qty_remaining: input.qtyRemaining,
    unit_cost: input.unitCost,
    notes: input.notes,
    status: input.qtyRemaining === 0 ? "closed" : "open",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("cocoblu_ageing")
    .update(payload as never)
    .eq("id", input.id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Update affected no rows.");
}

export interface InvoiceAudit {
  source: string | null;
  pdfPath: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/**
 * Fetch per-record audit fields from the base table (the ageing view doesn't
 * carry them). Returns a map keyed by record id. Degrades gracefully to an
 * empty map before the migration adds the columns.
 */
export async function fetchInvoiceAudit(): Promise<Map<string, InvoiceAudit>> {
  const { data, error } = await supabase.from("cocoblu_ageing").select("*");
  if (error) return new Map();
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    source?: string | null;
    pdf_url?: string | null;
    verified_by?: string | null;
    verified_at?: string | null;
  }>;
  const map = new Map<string, InvoiceAudit>();
  for (const r of rows) {
    map.set(r.id, {
      source: r.source ?? null,
      pdfPath: r.pdf_url ?? null,
      verifiedBy: r.verified_by ?? null,
      verifiedAt: r.verified_at ?? null,
    });
  }
  return map;
}
