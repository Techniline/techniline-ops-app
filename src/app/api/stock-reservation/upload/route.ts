import Anthropic from "@anthropic-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";

import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import type { UploadConfirmPayload, UploadPreview, UploadPreviewLine } from "@/lib/stock-reservation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── POST /api/stock-reservation/upload?action=preview|confirm ─────────────────

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "preview";

  if (action === "preview") return handlePreview(request);
  if (action === "confirm") return handleConfirm(request, auth);
  return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
}

// ── Preview: parse the PO PDF ─────────────────────────────────────────────────

async function handlePreview(request: Request) {
  let bytes: Uint8Array;
  let fileName = "upload.pdf";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
    if (file.size > 25_000_000) return Response.json({ ok: false, error: "File too large (max 25 MB)." }, { status: 413 });
    bytes = new Uint8Array(await file.arrayBuffer());
    fileName = file.name;
  } catch {
    return Response.json({ ok: false, error: "Could not read the upload." }, { status: 400 });
  }

  let preview: UploadPreview;
  try {
    preview = await parsePurchaseOrderPdf(bytes, fileName);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not parse the PDF." },
      { status: 400 }
    );
  }

  if (preview.lines.length === 0) {
    return Response.json({ ok: false, error: "No line items found in the PDF." }, { status: 400 });
  }

  return Response.json({ ok: true, ...preview });
}

// ── Confirm: save IMPO + lines to DB ─────────────────────────────────────────

async function handleConfirm(
  request: Request,
  auth: Awaited<ReturnType<typeof authorizeStockReservation>> & {}
) {
  const svc = auth!.serviceClient;
  let payload: UploadConfirmPayload;
  try {
    payload = await request.json() as UploadConfirmPayload;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!payload.impo_number?.trim()) {
    return Response.json({ ok: false, error: "IMPO number is required." }, { status: 400 });
  }
  if (!payload.lines?.length) {
    return Response.json({ ok: false, error: "No lines provided." }, { status: 400 });
  }

  // Upsert IMPO (by impo_number — idempotent re-upload; eta stays null until Grace sets it)
  const { data: impoData, error: impoErr } = await svc
    .from("impos")
    .upsert(
      {
        impo_number: payload.impo_number.trim(),
        eta: null,
        status: "pending",
        uploaded_by: auth!.uid,
        source_file_name: payload.source_file_name ?? null,
        total_skus: payload.lines.length,
      },
      { onConflict: "impo_number" }
    )
    .select("id")
    .single();

  if (impoErr || !impoData) {
    return Response.json(
      { ok: false, error: `Failed to save IMPO: ${impoErr?.message}` },
      { status: 500 }
    );
  }

  const impoId = (impoData as { id: string }).id;

  // Replace all lines (re-upload = replace)
  await svc.from("impo_lines").delete().eq("impo_id", impoId);

  const lines = payload.lines.map((l) => ({
    impo_id: impoId,
    brand: l.brand ?? null,
    item_code: l.item_code,
    description: l.description ?? null,
    category: l.category ?? null,
    qty_incoming: l.qty_incoming,
  }));

  for (let i = 0; i < lines.length; i += 100) {
    const { error: lineErr } = await svc.from("impo_lines").insert(lines.slice(i, i + 100));
    if (lineErr) {
      return Response.json(
        { ok: false, error: `Failed to save lines: ${lineErr.message}` },
        { status: 500 }
      );
    }
  }

  return Response.json({ ok: true, impo_number: payload.impo_number, saved_lines: lines.length });
}

// ── PDF parser ────────────────────────────────────────────────────────────────

const PO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    impo_number: {
      type: "string",
      description: "The full document number, e.g. 'IMPO/2600036'.",
    },
    vendor: {
      type: ["string", "null"],
      description: "Vendor / supplier company name.",
    },
    po_date: {
      type: ["string", "null"],
      description: "Purchase order date as YYYY-MM-DD if parseable, else null.",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          brand:       { type: ["string", "null"], description: "Brand name (e.g. Wharfedale, Quad Industrial)." },
          item_code:   { type: "string",           description: "Model No / item code (e.g. CPD3600, DELTAX215)." },
          description: { type: ["string", "null"], description: "Full product description." },
          qty:         { type: "number",           description: "Order quantity as a number." },
        },
        required: ["brand", "item_code", "description", "qty"],
      },
    },
  },
  required: ["impo_number", "vendor", "po_date", "items"],
} as const;

const PO_PROMPT = `You are extracting structured data from a Techniline Electronics PURCHASE ORDER PDF.

Extract:
- impo_number: the document number in the format IMPO/XXXXXXX (e.g. "IMPO/2600036")
- vendor: the supplier company name (e.g. "IAG Group LTD")
- po_date: the date as YYYY-MM-DD (e.g. "2026-06-18"), null if unclear
- items: every product line in the table with brand, item_code (Model No), description, and qty

The PDF text may have jumbled columns — use judgement to pair item_code/brand/description/qty correctly.
Each item row starts with a serial number (Sr). Brand sometimes appears on a separate line below the item.
Skip header rows, footer text, totals, and Terms & Conditions lines.`;

/** Basic regex fallback — extracts IMPO number only, no line items. */
function basicExtract(text: string): UploadPreview {
  const m = text.match(/IMPO\/(\d+)/);
  const impoNumber = m ? `IMPO/${m[1]}` : "IMPO/UNKNOWN";
  const dateM = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const poDate = dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : null;
  return { impo_number: impoNumber, vendor: null, po_date: poDate, lines: [], file_name: "" };
}

async function parsePurchaseOrderPdf(pdf: Uint8Array, fileName: string): Promise<UploadPreview> {
  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  const docText = (text ?? "").trim();

  if (docText.length < 20) {
    throw new Error("Could not read text from this PDF. Make sure it is a text-based PDF (not a scanned image).");
  }

  // Without AI key, fall back to basic extraction
  if (!process.env.ANTHROPIC_API_KEY) {
    const basic = basicExtract(docText);
    basic.file_name = fileName;
    return basic;
  }

  const client = new Anthropic();
  const params = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    output_config: { format: { type: "json_schema", schema: PO_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${PO_PROMPT}\n\n---DOCUMENT TEXT---\n${docText.slice(0, 24000)}`,
      },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const response = await client.messages.create(params);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    const basic = basicExtract(docText);
    basic.file_name = fileName;
    return basic;
  }

  let raw: {
    impo_number?: string;
    vendor?: string | null;
    po_date?: string | null;
    items?: Array<{ brand?: string | null; item_code?: string; description?: string | null; qty?: number }>;
  };
  try {
    raw = JSON.parse(block.text);
  } catch {
    const basic = basicExtract(docText);
    basic.file_name = fileName;
    return basic;
  }

  const lines: UploadPreviewLine[] = (raw.items ?? [])
    .filter((i) => i.item_code?.trim())
    .map((i) => ({
      brand:       i.brand?.trim() || null,
      item_code:   (i.item_code ?? "").trim(),
      description: i.description?.trim() || null,
      category:    null,
      qty_incoming: typeof i.qty === "number" && i.qty > 0 ? Math.round(i.qty) : 1,
    }));

  return {
    impo_number: raw.impo_number?.trim() || basicExtract(docText).impo_number,
    vendor:      raw.vendor?.trim() || null,
    po_date:     raw.po_date?.trim() || null,
    lines,
    file_name:   fileName,
  };
}
