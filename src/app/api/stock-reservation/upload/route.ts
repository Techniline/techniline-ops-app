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

const KNOWN_BRANDS = [
  "Behringer", "Turbosound", "Midas", "TC Electronics", "TC Helicon", "Klark Teknik",
  "Wharfedale", "Quad Industrial", "Crown", "QSC",
];
const BRAND_LINE_RE = new RegExp(`^(${KNOWN_BRANDS.join("|")})\\s*$`, "i");

/**
 * Pure-regex parser — works without an AI key.
 *
 * Techniline POs have two column orderings depending on which page column the
 * PDF renderer outputs first:
 *   Pattern A  →  {Sr} {ModelNo} {Description...} {Qty}   (brand on next line)
 *   Pattern B  →  {Sr} {Qty} {ModelNo} {Description...}   (brand on next or same line)
 *
 * We scan each table section (between the "Sr Brand…" header and "Terms & Conditions")
 * and classify every row by checking whether the token after Sr is a decimal number.
 */
function regexExtract(text: string): { impo_number: string; vendor: string | null; po_date: string | null; lines: UploadPreviewLine[] } {
  // ── Header fields ────────────────────────────────────────────────────────
  const impoM = text.match(/IMPO\/(\d+)/);
  const impoNumber = impoM ? `IMPO/${impoM[1]}` : "IMPO/UNKNOWN";
  const dateM = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const poDate = dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : null;

  // Vendor sits just before or after the IMPO number block
  let vendor: string | null = null;
  const vendorM = text.match(/(?:Vendors?\s+Name[^]*?\n)([\w][\w ,.()\-]+(?:Ltd|LLC|Pte|Inc|GmbH|Group)[.,]?[^\n]*)/i);
  if (vendorM) vendor = vendorM[1].trim();

  // ── Line items ───────────────────────────────────────────────────────────
  const lines: UploadPreviewLine[] = [];

  // Every page header is "Sr Brand Model No Description Qty" — find all table sections
  const headerRe = /Sr\s+Brand\s+Model\s+No\s+Description\s+Qty/g;
  let hMatch: RegExpExecArray | null;

  while ((hMatch = headerRe.exec(text)) !== null) {
    const sectionStart = hMatch.index + hMatch[0].length;
    const tcIdx = text.indexOf("Terms & Conditions", sectionStart);
    const sectionEnd = tcIdx > sectionStart ? tcIdx : sectionStart + 6000;
    const section = text.slice(sectionStart, sectionEnd);
    const rows = section.split("\n").map((l) => l.trim()).filter(Boolean);

    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      // Must start with a serial number
      const srM = row.match(/^(\d+)\s+(.*)/);
      if (!srM) { i++; continue; }

      const rest = srM[2].trim();

      let brand: string | null = null;
      let item_code = "";
      let description = "";
      let qty_incoming = 0;

      // Pattern B: next token is decimal qty (e.g. "14.00")
      const qtyFirstM = rest.match(/^(\d+(?:\.\d+)?)\s+([\w/]+)\s*(.*)/);
      // Pattern A: next token is a model code (starts with letter/digit, no decimal)
      const modelFirstM = rest.match(/^([A-Z0-9][A-Z0-9/\-]+)\s+(.*?)\s+(\d+(?:\.\d+)?)$/);

      if (qtyFirstM && !isNaN(parseFloat(qtyFirstM[1])) && parseFloat(qtyFirstM[1]) < 10000) {
        qty_incoming = parseFloat(qtyFirstM[1]);
        const secondToken = qtyFirstM[2];
        const remaining   = qtyFirstM[3].trim();

        // Check if secondToken is actually a known brand (Pattern C: Sr Qty Brand ModelNo Desc)
        const isBrand = KNOWN_BRANDS.some((b) => b.toLowerCase() === secondToken.toLowerCase());
        if (isBrand) {
          brand = secondToken;
          const modelAndDesc = remaining.match(/^(\S+)\s*(.*)/);
          item_code   = modelAndDesc ? modelAndDesc[1] : remaining;
          description = modelAndDesc ? modelAndDesc[2].trim() : "";
        } else {
          item_code   = secondToken;
          description = remaining;
        }
        i++;
        // Collect wrapped description lines
        while (i < rows.length && !rows[i].match(/^\d+\s+/) && !BRAND_LINE_RE.test(rows[i])) {
          description += " " + rows[i];
          i++;
        }
        // Brand on its own line
        if (i < rows.length && BRAND_LINE_RE.test(rows[i])) { brand = rows[i]; i++; }
      } else if (modelFirstM) {
        item_code   = modelFirstM[1];
        description = modelFirstM[2].trim();
        qty_incoming = parseFloat(modelFirstM[3]);
        i++;
        if (i < rows.length && BRAND_LINE_RE.test(rows[i])) { brand = rows[i]; i++; }
      } else {
        i++;
        continue;
      }

      if (item_code && qty_incoming > 0) {
        lines.push({
          brand:       brand?.trim() || null,
          item_code:   item_code.trim(),
          description: description.replace(/\s+/g, " ").trim() || null,
          category:    null,
          qty_incoming: Math.round(qty_incoming),
        });
      }
    }
  }

  return { impo_number: impoNumber, vendor, po_date: poDate, lines };
}

const AI_PROMPT = `You are extracting structured data from a Techniline Electronics PURCHASE ORDER PDF text.

The table columns are: Sr | Brand | Model No | Description | Qty
However the text extraction sometimes produces two different column orderings:
  - "{Sr} {ModelNo} {Description} {Qty}" with brand on a separate next line
  - "{Sr} {Qty} {ModelNo} {Description}" with brand on a separate next line or inline

Return ONLY a raw JSON object (no markdown, no explanation) with this exact shape:
{
  "impo_number": "IMPO/XXXXXXX",
  "vendor": "Supplier Company Name or null",
  "po_date": "YYYY-MM-DD or null",
  "items": [
    { "brand": "Behringer", "item_code": "PMP1680S", "description": "Mixer Powered...", "qty": 14 }
  ]
}

Rules:
- Include every numbered product row (Sr 1, 2, 3…). Do NOT skip any.
- brand: the brand column value (Behringer / Turbosound / Midas / TC Electronics / TC Helicon / Klark Teknik etc.)
- item_code: the Model No (e.g. PMP1680S, B115D, iQ15, GOXLRMINIWhite)
- qty: integer quantity
- Skip header rows, page footers, "Terms & Conditions", and blank lines.`;

async function parsePurchaseOrderPdf(pdf: Uint8Array, fileName: string): Promise<UploadPreview> {
  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  const docText = (text ?? "").trim();

  if (docText.length < 20) {
    throw new Error("Could not read text from this PDF. Make sure it is a text-based PDF (not a scanned image).");
  }

  // Try AI first if API key is available
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        system: "You are a data extraction assistant. Always respond with valid JSON only — no markdown fences, no explanation.",
        messages: [
          {
            role: "user",
            content: `${AI_PROMPT}\n\n---DOCUMENT TEXT---\n${docText.slice(0, 40000)}`,
          },
        ],
      });

      const block = response.content.find((b) => b.type === "text");
      if (block && block.type === "text") {
        let jsonText = block.text.trim();
        // Strip markdown fences if the model added them despite instructions
        const fenceM = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (fenceM) jsonText = fenceM[1];

        const raw = JSON.parse(jsonText) as {
          impo_number?: string;
          vendor?: string | null;
          po_date?: string | null;
          items?: Array<{ brand?: string | null; item_code?: string; description?: string | null; qty?: number }>;
        };

        const lines: UploadPreviewLine[] = (raw.items ?? [])
          .filter((i) => i.item_code?.trim())
          .map((i) => ({
            brand:        i.brand?.trim() || null,
            item_code:    (i.item_code ?? "").trim(),
            description:  i.description?.trim() || null,
            category:     null,
            qty_incoming: typeof i.qty === "number" && i.qty > 0 ? Math.round(i.qty) : 1,
          }));

        if (lines.length > 0) {
          const fallback = regexExtract(docText);
          return {
            impo_number: raw.impo_number?.trim() || fallback.impo_number,
            vendor:      raw.vendor?.trim() || fallback.vendor,
            po_date:     raw.po_date?.trim() || fallback.po_date,
            lines,
            file_name:   fileName,
          };
        }
      }
    } catch {
      // AI failed — fall through to regex
    }
  }

  // Regex fallback (works without an API key)
  const extracted = regexExtract(docText);
  return { ...extracted, file_name: fileName };
}
