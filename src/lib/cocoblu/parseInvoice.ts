import Anthropic from "@anthropic-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";

import type { InvoiceDraft, InvoiceLineItem } from "./invoiceTypes";

/**
 * JSON Schema for the structured extraction. Structured outputs require every
 * property to be listed in `required` and `additionalProperties: false`;
 * optionality is expressed with nullable types.
 */
const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    invoice_number: { type: ["string", "null"] },
    invoice_date: {
      type: ["string", "null"],
      description: "Invoice date in ISO format YYYY-MM-DD",
    },
    supplied_date: {
      type: ["string", "null"],
      description: "Delivery/supplied date in ISO YYYY-MM-DD, or null if absent",
    },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: {
            type: "string",
            description: "The product Model No / SKU code",
          },
          description: { type: ["string", "null"] },
          brand: { type: ["string", "null"] },
          qty: { type: ["number", "null"], description: "Quantity supplied" },
          unit_cost: {
            type: ["number", "null"],
            description: "Unit price (not the line amount)",
          },
        },
        required: ["sku", "description", "brand", "qty", "unit_cost"],
      },
    },
  },
  required: ["invoice_number", "invoice_date", "supplied_date", "line_items"],
} as const;

const PROMPT = `You are extracting structured data from a supplier TAX INVOICE (Cocoblu / Microless). Return the invoice header and one entry per product line item.

Rules:
- SKU is the "Model No" column value (e.g. STRATACLUBKIT, NITROPROKIT). Never use the row number or brand as the SKU.
- qty is the "Qty" column; unit_cost is the per-unit "Price" column (NOT the line "Amount").
- Convert all dates to ISO format YYYY-MM-DD (the invoice uses DD/MM/YYYY).
- Include only real product lines. Skip totals, VAT, subtotal, "amount in words", and any summary rows.
- The source text is extracted from a PDF and the table columns may be misaligned or wrapped across lines — use your judgement to associate each model with its quantity and price.
- If a field is genuinely missing, use null. Do not invent values.`;

interface RawLine {
  sku?: string | null;
  description?: string | null;
  brand?: string | null;
  qty?: number | null;
  unit_cost?: number | null;
}
interface RawDraft {
  invoice_number?: string | null;
  invoice_date?: string | null;
  supplied_date?: string | null;
  line_items?: RawLine[];
}

/**
 * Extract text from the PDF and use Claude (Sonnet 4.6, structured output) to
 * capture the invoice header + line items. Returns a draft for human
 * verification — it does NOT write to the database.
 */
export async function parseInvoicePdf(pdf: Uint8Array): Promise<InvoiceDraft> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }

  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  const invoiceText = (text ?? "").trim();
  if (invoiceText.length < 20) {
    throw new Error(
      "Could not read text from this PDF (it may be a scanned image — a text-based PDF is required)."
    );
  }

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  // output_config is a newer Messages param; cast keeps us compatible across
  // SDK type versions without resorting to `any`.
  const params = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    output_config: { format: { type: "json_schema", schema: INVOICE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${PROMPT}\n\n---INVOICE TEXT---\n${invoiceText.slice(0, 24000)}`,
      },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const response = await client.messages.create(params);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("The extraction model returned no structured output.");
  }

  let raw: RawDraft;
  try {
    raw = JSON.parse(block.text) as RawDraft;
  } catch {
    throw new Error("Could not parse the extraction result.");
  }

  const lineItems: InvoiceLineItem[] = (raw.line_items ?? [])
    .filter((l) => (l.sku ?? "").trim() !== "")
    .map((l) => ({
      sku: (l.sku ?? "").trim(),
      description: l.description?.trim() || null,
      brand: l.brand?.trim() || null,
      qty: typeof l.qty === "number" && Number.isFinite(l.qty) ? l.qty : null,
      unitCost:
        typeof l.unit_cost === "number" && Number.isFinite(l.unit_cost)
          ? l.unit_cost
          : null,
    }));

  return {
    invoiceNumber: raw.invoice_number?.trim() || null,
    invoiceDate: raw.invoice_date?.trim() || null,
    suppliedDate: raw.supplied_date?.trim() || null,
    lineItems,
  };
}
