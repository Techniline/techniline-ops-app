import Anthropic from "@anthropic-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";

import { logAiUsage } from "./aiUsage";

export interface InvoiceDraft {
  invoiceNumber: string | null;
  invoiceValue: number | null;
  customerName: string | null;
  skus: string[];
  engine: "ai" | "basic";
}

const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    invoice_number: { type: ["string", "null"], description: "The TLE invoice number / document number" },
    customer_name: { type: ["string", "null"], description: "The customer / bill-to / buyer name on the invoice" },
    invoice_total: {
      type: ["number", "null"],
      description: "The final total amount payable (grand total including VAT), as a number",
    },
    skus: {
      type: "array",
      items: { type: "string" },
      description: "Every product Model No / SKU / item code, one per product line. Exclude totals, VAT and summary rows.",
    },
  },
  required: ["invoice_number", "customer_name", "invoice_total", "skus"],
} as const;

const PROMPT = `You are extracting structured data from a Techniline (TLE) TAX INVOICE.
Return:
- invoice_number: the invoice / document number.
- invoice_total: the FINAL total amount payable (grand total including VAT), as a plain number (no currency symbol or commas).
- skus: the product Model No / SKU / item code for EACH product line item.

Rules:
- Use the item/model code as the SKU, never the row number, description or brand.
- Include only real product lines. Skip subtotal, VAT, total, "amount in words" and any summary rows.
- The text is extracted from a PDF and columns may be misaligned or wrapped — use judgement.
- If a field is genuinely missing, use null (or an empty array for skus). Do not invent values.`;

interface RawDraft {
  invoice_number?: string | null;
  customer_name?: string | null;
  invoice_total?: number | null;
  skus?: string[];
}

/** Best-effort parse without AI: invoice number + the largest money figure. */
function parseBasic(text: string): InvoiceDraft {
  const numMatch = text.match(/invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9/\-]+)/i);
  const amounts = [...text.matchAll(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
  const total = amounts.length ? Math.max(...amounts) : null;
  return {
    invoiceNumber: numMatch ? numMatch[1].trim() : null,
    invoiceValue: total,
    customerName: null,
    skus: [],
    engine: "basic",
  };
}

/** Extract invoice number, total value and SKUs from an uploaded TLE invoice PDF. */
export async function parseTleInvoice(pdf: Uint8Array): Promise<InvoiceDraft> {
  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  const invoiceText = (text ?? "").trim();
  if (invoiceText.length < 20) {
    throw new Error("Could not read text from this PDF (it may be a scanned image — a text-based PDF is required).");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return parseBasic(invoiceText);
  }

  const client = new Anthropic();
  const params = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    output_config: { format: { type: "json_schema", schema: INVOICE_SCHEMA } },
    messages: [
      { role: "user", content: `${PROMPT}\n\n---INVOICE TEXT---\n${invoiceText.slice(0, 24000)}` },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const response = await client.messages.create(params);
  void logAiUsage("order_invoice", "claude-sonnet-4-6", response.usage as { input_tokens?: number; output_tokens?: number });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    // Fall back rather than failing the whole upload.
    return parseBasic(invoiceText);
  }
  let raw: RawDraft;
  try {
    raw = JSON.parse(block.text) as RawDraft;
  } catch {
    return parseBasic(invoiceText);
  }

  const skus = (raw.skus ?? [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return {
    invoiceNumber: raw.invoice_number?.trim() || null,
    invoiceValue:
      typeof raw.invoice_total === "number" && Number.isFinite(raw.invoice_total) ? raw.invoice_total : null,
    customerName: raw.customer_name?.trim() || null,
    skus: [...new Set(skus)],
    engine: "ai",
  };
}
