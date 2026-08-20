import Anthropic from "@anthropic-ai/sdk";
import { extractText } from "unpdf";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUser(request: Request): Promise<{ id: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

export interface ParsedDocument {
  ok: boolean;
  customer_name?: string;
  doc_no?: string;
  doc_date?: string;
  items?: ParsedItem[];
  error?: string;
}

export interface ParsedItem {
  model_no: string;
  brand: string;
  description: string;
  qty: number;
  unit_price: number;
}

const STRIP_PREFIXES = /^(JBA|TLE|TLC|SND)/i;

function cleanModelNo(raw: string): string {
  return raw.replace(STRIP_PREFIXES, "").trim();
}

export async function POST(request: Request): Promise<Response> {
  if (!(await getUser(request))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "ANTHROPIC_API_KEY not configured on this server." }, { status: 500 });
  }

  let pdfText = "";
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file || file.type !== "application/pdf") {
      return Response.json({ ok: false, error: "Please upload a PDF file." }, { status: 400 });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const { text } = await extractText(buf, { mergePages: true });
    pdfText = Array.isArray(text) ? text.join("\n") : (text as string);
  } catch {
    return Response.json({ ok: false, error: "Could not read PDF. Check the file is not encrypted." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Extract all line items from this document (Quotation, Proforma Invoice, or Tax Invoice).

Return ONLY a valid JSON object — no markdown, no explanation:
{
  "customer_name": "...",
  "doc_no": "...",
  "doc_date": "YYYY-MM-DD or empty string",
  "items": [
    { "model_no": "...", "brand": "...", "description": "...", "qty": 0, "unit_price": 0 }
  ]
}

Rules:
- model_no: use the MANUFACTURER model number. Strip internal warehouse prefixes: if model starts with JBA, TLE, TLC, or SND remove those letters (e.g. JBAX32 → X32, TLEHPX2000 → HPX2000).
- brand: manufacturer / brand name (Behringer, Wharfedale, Midas, etc.)
- description: product description
- qty: quantity as a plain number (not a string)
- unit_price: unit price as a plain number, 0 if not shown
- doc_no: the document/invoice/quotation number
- doc_date: date in YYYY-MM-DD, or empty string

Document text:
${pdfText}`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON in response");

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      customer_name?: string;
      doc_no?: string;
      doc_date?: string;
      items?: Array<{ model_no: string; brand: string; description: string; qty: number; unit_price: number }>;
    };

    const items: ParsedItem[] = (parsed.items ?? [])
      .filter((i) => i.model_no && i.qty > 0)
      .map((i) => ({
        model_no: cleanModelNo(i.model_no),
        brand: i.brand ?? "",
        description: i.description ?? "",
        qty: Number(i.qty) || 0,
        unit_price: Number(i.unit_price) || 0,
      }));

    return Response.json({
      ok: true,
      customer_name: parsed.customer_name ?? "",
      doc_no: parsed.doc_no ?? "",
      doc_date: parsed.doc_date ?? "",
      items,
    });
  } catch (e) {
    return Response.json({ ok: false, error: `Parse failed: ${e instanceof Error ? e.message : "Unknown error"}` }, { status: 500 });
  }
}
