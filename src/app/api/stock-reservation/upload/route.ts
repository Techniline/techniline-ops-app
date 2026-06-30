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
  "TC Electronics", "TC Helicon", "Klark Teknik",
  "Turbosound", "Behringer", "Midas",
  "Wharfedale", "Quad Industrial", "Crown", "QSC",
];

/**
 * Pure-regex parser — no AI key needed, works offline.
 *
 * unpdf with mergePages:true produces a SINGLE flat string (no newlines).
 * Actual format from this PDF:
 *   "{Sr} {Qty.2dec}{ModelCode} {Description} {Brand}"
 *   e.g. "1 14.00PMP1680S Mixer Powered 10 CH... Behringer"
 *
 * Key observations (confirmed by testing against the real PDF):
 *   - Qty and ModelCode are MERGED with no space (e.g. "14.00PMP1680S")
 *   - ModelCode may start with a digit (e.g. "1002SFX")
 *   - Brand appears at the END, sometimes concatenated to the last word
 *   - Each page ends with "Terms & Conditions" which must be stripped
 */
function regexExtract(text: string): { impo_number: string; vendor: string | null; po_date: string | null; lines: UploadPreviewLine[] } {
  const impoM = text.match(/IMPO\/(\d+)/);
  const impoNumber = impoM ? `IMPO/${impoM[1]}` : "IMPO/UNKNOWN";

  const dateM = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const poDate = dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : null;

  // Vendor — appears near the start before "PURCHASE ORDER"
  let vendor: string | null = null;
  const vendorM = text.slice(0, 600).match(/([A-Z][a-zA-Z]+(?:\s+[A-Za-z.,()]+)*\s+(?:Ltd|LLC|Pte|Inc|GmbH|Group|Co)\.?(?:\s+Ltd\.?)?)/);
  if (vendorM) vendor = vendorM[1].trim();

  // ── Item extraction ──────────────────────────────────────────────────────
  // Match "{Sr_number} {Qty.2decimals}{ModelCode_non-space_2+chars} "
  const ITEM_RE = /\b(\d{1,3}) (\d+\.\d{2})(\S{2,}) /g;
  const rawMatches: Array<{ index: number; end: number; sr: number; qty: number; model: string }> = [];

  let m: RegExpExecArray | null;
  while ((m = ITEM_RE.exec(text)) !== null) {
    rawMatches.push({ index: m.index, end: m.index + m[0].length, sr: +m[1], qty: parseFloat(m[2]), model: m[3] });
  }

  // Keep only the sequential run starting from Sr=1 (eliminates false positives)
  const seqMatches: typeof rawMatches = [];
  let expected = 1;
  for (const x of rawMatches) {
    if (x.sr === expected) { seqMatches.push(x); expected++; }
  }

  const lines: UploadPreviewLine[] = [];

  for (let i = 0; i < seqMatches.length; i++) {
    const curr = seqMatches[i];
    const nextStart = i + 1 < seqMatches.length ? seqMatches[i + 1].index : text.length;
    let chunk = text.slice(curr.end, nextStart).trim();

    // Strip page-footer noise ("Terms & Conditions Stamp & Signature…")
    const tcIdx = chunk.indexOf("Terms & Conditions");
    if (tcIdx > 0) chunk = chunk.slice(0, tcIdx).trim();

    // Brand sits at the end — may be concatenated directly (no space) to last description word
    let brand: string | null = null;
    for (const b of KNOWN_BRANDS) {
      if (chunk.endsWith(b)) {
        brand = b;
        chunk = chunk.slice(0, chunk.length - b.length).trim();
        break;
      }
    }

    lines.push({
      brand,
      item_code:   curr.model,
      description: chunk.replace(/\s+/g, " ").trim() || null,
      category:    null,
      qty_incoming: Math.round(curr.qty),
    });
  }

  return { impo_number: impoNumber, vendor, po_date: poDate, lines };
}

const AI_PROMPT = `You are extracting structured data from a Techniline Electronics PURCHASE ORDER PDF text.

The PDF text extractor produces a SINGLE flat string (no newlines). Each item row follows this format:
  "{Sr} {Qty.2decimals}{ModelCode} {Description} {Brand}"
  e.g. "1 14.00PMP1680S Mixer Powered 10 CH (6 Mono & 2 Stereo) 2x800W Peak... Behringer"

The Qty and ModelCode are MERGED with no space between them. Brand appears at the END of each item.
Known brands: Behringer, Turbosound, Midas, TC Electronics, TC Helicon, Klark Teknik, Wharfedale.

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
- item_code: the Model No immediately after the Qty (e.g. PMP1680S, 1002SFX, iQ15)
- qty: integer quantity
- Skip "Terms & Conditions", page headers, and footer text.`;

async function parsePurchaseOrderPdf(pdf: Uint8Array, fileName: string): Promise<UploadPreview> {
  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  const docText = (text ?? "").trim();

  if (docText.length < 20) {
    throw new Error("Could not read text from this PDF. Make sure it is a text-based PDF (not a scanned image).");
  }

  // ── Regex parser (fast, no API cost) ─────────────────────────────────────
  const extracted = regexExtract(docText);

  // If regex found items, use them directly — no API call needed
  if (extracted.lines.length > 0) {
    return { ...extracted, file_name: fileName };
  }

  // ── AI fallback (when regex finds nothing — different PDF format) ─────────
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

  // Both regex and AI failed — return what regex found (may be empty)
  return { ...extracted, file_name: fileName };
}
