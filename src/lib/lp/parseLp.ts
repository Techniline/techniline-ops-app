import Anthropic from "@anthropic-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";

import { parseLpBasic } from "./basicParse";
import type { LpDraft, LpLineItem, ParsedLp } from "./parseTypes";

/**
 * JSON Schema for the structured extraction. Structured outputs require every
 * property to be listed in `required` and `additionalProperties: false`;
 * optionality is expressed with nullable types.
 */
const LP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lp_number: { type: ["string", "null"], description: "The LPO / purchase order number, e.g. LPO/2600074" },
    lp_date: { type: ["string", "null"], description: "LPO date in ISO format YYYY-MM-DD" },
    vendor_name: { type: ["string", "null"] },
    vendor_trn: { type: ["string", "null"], description: "Consigner (supplier) TRN" },
    consignee_trn: { type: ["string", "null"], description: "Consignee (buyer) TRN" },
    qtn_ref: { type: ["string", "null"] },
    amount_before_vat: { type: ["number", "null"] },
    vat_amount: { type: ["number", "null"] },
    net_amount: { type: ["number", "null"], description: "Gross/net total including VAT" },
    terms: { type: ["string", "null"], description: "Payment terms, e.g. 60 Days Credit" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          line_number: { type: ["number", "null"] },
          brand: { type: ["string", "null"] },
          model_no: { type: "string", description: "The Model No / SKU code (never the row number or brand)" },
          description: { type: ["string", "null"] },
          qty: { type: ["number", "null"] },
          unit_price: { type: ["number", "null"], description: "Per-unit Price (NOT the line Amount)" },
          amount: { type: ["number", "null"], description: "Line total Amount" },
          disc_amount: { type: ["number", "null"] },
        },
        required: ["line_number", "brand", "model_no", "description", "qty", "unit_price", "amount", "disc_amount"],
      },
    },
  },
  required: [
    "lp_number", "lp_date", "vendor_name", "vendor_trn", "consignee_trn",
    "qtn_ref", "amount_before_vat", "vat_amount", "net_amount", "terms", "line_items",
  ],
} as const;

const PROMPT = `You are extracting structured data from a Techniline "PURCHASE ORDER" (Local Purchase Order / LPO). Return the header and one entry per product line item.

Rules:
- model_no is the "Model No" column value (e.g. XV1R, LP646NYVSB). Never use the row number (Sr) or the brand as model_no.
- qty is the "Qty" column; unit_price is the per-unit "Price" column (NOT the line "Amount"); amount is the line total.
- Convert all dates to ISO YYYY-MM-DD (the document uses DD/MM/YYYY).
- vendor_trn is "TRN of Consigner"; consignee_trn is "TRN of Consignee".
- Include only real product lines. Skip totals, VAT, "amount in words", and summary rows.
- The text is extracted from a PDF and columns may be glued together or wrapped — use judgement to associate each model with its qty, price and amount.
- If a field is genuinely missing, use null. Do not invent values.`;

interface RawLine {
  line_number?: number | null;
  brand?: string | null;
  model_no?: string | null;
  description?: string | null;
  qty?: number | null;
  unit_price?: number | null;
  amount?: number | null;
  disc_amount?: number | null;
}
interface RawDraft {
  lp_number?: string | null;
  lp_date?: string | null;
  vendor_name?: string | null;
  vendor_trn?: string | null;
  consignee_trn?: string | null;
  qtn_ref?: string | null;
  amount_before_vat?: number | null;
  vat_amount?: number | null;
  net_amount?: number | null;
  terms?: string | null;
  line_items?: RawLine[];
}

/**
 * Extract text from the LPO PDF and capture the header + line items for human
 * verification. Uses the free built-in parser by default; if ANTHROPIC_API_KEY
 * is configured it upgrades to AI extraction (Claude Sonnet 4.6). Never writes
 * to the database.
 */
export async function parseLpPdf(pdf: Uint8Array): Promise<ParsedLp> {
  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  const lpText = (text ?? "").trim();
  if (lpText.length < 20) {
    throw new Error(
      "Could not read text from this PDF (it may be a scanned image — a text-based PDF is required)."
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { draft: parseLpBasic(lpText), engine: "basic" };
  }
  return { draft: await parseWithAI(lpText), engine: "ai" };
}

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** AI extraction via Claude Sonnet 4.6 (structured output). */
async function parseWithAI(lpText: string): Promise<LpDraft> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  // output_config is a newer Messages param; cast keeps us compatible across
  // SDK type versions without resorting to `any`.
  const params = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    output_config: { format: { type: "json_schema", schema: LP_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${PROMPT}\n\n---LPO TEXT---\n${lpText.slice(0, 24000)}`,
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

  const lineItems: LpLineItem[] = (raw.line_items ?? [])
    .filter((l) => (l.model_no ?? "").trim() !== "")
    .map((l) => ({
      lineNumber: n(l.line_number),
      brand: l.brand?.trim() || null,
      modelNo: (l.model_no ?? "").trim(),
      description: l.description?.trim() || null,
      qty: n(l.qty),
      unitPrice: n(l.unit_price),
      amount: n(l.amount),
      discAmount: n(l.disc_amount) ?? 0,
    }));

  return {
    lpNumber: raw.lp_number?.trim() || null,
    lpDate: raw.lp_date?.trim() || null,
    vendorName: raw.vendor_name?.trim() || null,
    vendorTrn: raw.vendor_trn?.trim() || null,
    consigneeTrn: raw.consignee_trn?.trim() || null,
    qtnRef: raw.qtn_ref?.trim() || null,
    amountBeforeVat: n(raw.amount_before_vat),
    vatAmount: n(raw.vat_amount),
    netAmount: n(raw.net_amount),
    terms: raw.terms?.trim() || null,
    lineItems,
  };
}
