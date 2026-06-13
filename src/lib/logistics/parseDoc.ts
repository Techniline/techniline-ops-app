import Anthropic from "@anthropic-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";

export interface DocItem {
  sku: string | null;
  description: string | null;
  brand: string | null;
  qty: number | null;
}

export interface DocDraft {
  docType: "invoice" | "delivery_note" | "other";
  invoiceNumber: string | null;
  doNumber: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
  poNumber: string | null;
  totalValue: number | null;
  items: DocItem[];
  engine: "ai" | "basic";
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_type: {
      type: "string",
      enum: ["invoice", "delivery_note", "other"],
      description: "‘invoice’ for a TAX INVOICE, ‘delivery_note’ for a DELIVERY NOTE / DO, else ‘other’.",
    },
    invoice_number: { type: ["string", "null"], description: "Invoice no (e.g. WS/2601706)" },
    do_number: { type: ["string", "null"], description: "Delivery order / DO number (e.g. DO/260000737); only on delivery notes" },
    customer_name: { type: ["string", "null"], description: "Customer / consignee name" },
    delivery_address: { type: ["string", "null"], description: "Delivery address / branch (mainly on delivery notes)" },
    po_number: { type: ["string", "null"], description: "Customer PO# or Ref.No (e.g. MLPO-1206202)" },
    total_value: {
      type: ["number", "null"],
      description: "Grand total payable incl VAT (the ‘Net Amount’) as a number; null if the document shows no value (typical for delivery notes)",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: { type: ["string", "null"], description: "Model No / item code" },
          description: { type: ["string", "null"] },
          brand: { type: ["string", "null"] },
          qty: { type: ["number", "null"] },
        },
        required: ["sku", "description", "brand", "qty"],
      },
    },
  },
  required: ["document_type", "invoice_number", "do_number", "customer_name", "delivery_address", "po_number", "total_value", "items"],
} as const;

const PROMPT = `You are extracting structured data from a Techniline Electronics document — either a TAX INVOICE or a DELIVERY NOTE (DO).
Return document_type and these fields:
- invoice_number: e.g. "WS/2601706".
- do_number: the delivery order number e.g. "DO/260000737" (only present on delivery notes; null otherwise).
- customer_name: the customer / consignee (e.g. "MELODICA MUSIC ACADEMY LLC").
- delivery_address: the ship-to branch / address if shown (mainly on delivery notes).
- po_number: the customer PO# / Ref.No (e.g. "MLPO-1206202").
- total_value: the grand total payable INCLUDING VAT (labelled "Net Amount"), as a plain number; null if the document has no amounts (delivery notes usually don't).
- items: one entry per product line — sku (the Model No, e.g. "XR16"), description, brand, qty.

Rules: the text is extracted from a PDF and columns may be jumbled — use judgement to pair model/brand/qty/description. Skip totals/VAT/declaration rows in items. If a field is genuinely missing, use null.`;

interface RawItem {
  sku?: string | null;
  description?: string | null;
  brand?: string | null;
  qty?: number | null;
}
interface RawDoc {
  document_type?: string;
  invoice_number?: string | null;
  do_number?: string | null;
  customer_name?: string | null;
  delivery_address?: string | null;
  po_number?: string | null;
  total_value?: number | null;
  items?: RawItem[];
}

function basic(text: string): DocDraft {
  const inv = text.match(/\b([A-Z]{1,3}\/\d{6,})\b/);
  const doNo = text.match(/\bDO\/?\s?(\d{6,})\b/i);
  const isDO = /delivery note/i.test(text);
  return {
    docType: isDO ? "delivery_note" : /tax invoice/i.test(text) ? "invoice" : "other",
    invoiceNumber: inv ? inv[1] : null,
    doNumber: doNo ? `DO/${doNo[1]}` : null,
    customerName: null,
    deliveryAddress: null,
    poNumber: null,
    totalValue: null,
    items: [],
    engine: "basic",
  };
}

/** Parse a Techniline invoice OR delivery note PDF into a unified draft. */
export async function parseLogisticsDoc(pdf: Uint8Array): Promise<DocDraft> {
  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  const docText = (text ?? "").trim();
  if (docText.length < 20) {
    throw new Error("Could not read text from this PDF (it may be a scanned image — a text-based PDF is required).");
  }
  if (!process.env.ANTHROPIC_API_KEY) return basic(docText);

  const client = new Anthropic();
  const params = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `${PROMPT}\n\n---DOCUMENT TEXT---\n${docText.slice(0, 24000)}` }],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const response = await client.messages.create(params);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return basic(docText);
  let raw: RawDoc;
  try {
    raw = JSON.parse(block.text) as RawDoc;
  } catch {
    return basic(docText);
  }

  const items: DocItem[] = (raw.items ?? [])
    .filter((i) => (i.sku ?? i.description ?? "").toString().trim() !== "")
    .map((i) => ({
      sku: i.sku?.trim() || null,
      description: i.description?.trim() || null,
      brand: i.brand?.trim() || null,
      qty: typeof i.qty === "number" && Number.isFinite(i.qty) ? i.qty : null,
    }));

  const dt = raw.document_type === "invoice" || raw.document_type === "delivery_note" ? raw.document_type : "other";
  return {
    docType: dt,
    invoiceNumber: raw.invoice_number?.trim() || null,
    doNumber: raw.do_number?.trim() || null,
    customerName: raw.customer_name?.trim() || null,
    deliveryAddress: raw.delivery_address?.trim() || null,
    poNumber: raw.po_number?.trim() || null,
    totalValue: typeof raw.total_value === "number" && Number.isFinite(raw.total_value) ? raw.total_value : null,
    items,
    engine: "ai",
  };
}

/** Short human-readable items summary, e.g. "4 × Mixer Audio 16 CH (XR16)". */
export function itemsSummary(items: DocItem[]): string {
  return items
    .map((i) => {
      const qty = i.qty != null ? `${i.qty % 1 === 0 ? i.qty : i.qty} × ` : "";
      const name = i.description ?? i.sku ?? "";
      const sku = i.sku && i.description ? ` (${i.sku})` : "";
      return `${qty}${name}${sku}`.trim();
    })
    .filter(Boolean)
    .join("; ");
}
