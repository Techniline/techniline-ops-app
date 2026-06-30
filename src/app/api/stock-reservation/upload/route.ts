import * as XLSX from "xlsx";

import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import type { UploadConfirmPayload, UploadPreviewGroup, UploadPreviewLine } from "@/lib/stock-reservation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ── POST /api/stock-reservation/upload?action=preview|confirm ─────────────────

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true); // manager only
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "preview";

  if (action === "preview") return handlePreview(request, auth.serviceClient);
  if (action === "confirm") return handleConfirm(request, auth);
  return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
}

// ── Preview: parse Excel, return grouped rows ─────────────────────────────────

async function handlePreview(request: Request, _svc: unknown) {
  let bytes: Uint8Array;
  let fileName = "upload.xlsx";
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

  let rows: ParsedRow[];
  try {
    rows = parseExcel(bytes);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Could not parse Excel." }, { status: 400 });
  }

  if (rows.length === 0) {
    return Response.json({ ok: false, error: "No data rows found in the file." }, { status: 400 });
  }

  // Group by IMPO number (if column exists) or by ETA
  const groupMap = new Map<string, { eta: string; impo: string; lines: UploadPreviewLine[] }>();
  let groupCounter = 1;

  for (const row of rows) {
    const impoKey = row.impo_number?.trim() || "";
    const etaKey = row.eta_raw ?? "";
    const mapKey = impoKey || etaKey || "unknown";

    if (!groupMap.has(mapKey)) {
      const suggested = impoKey || `IMPO-${formatDateSlug(row.eta_raw)}-${String(groupCounter++).padStart(2, "0")}`;
      groupMap.set(mapKey, { eta: row.eta_iso ?? "", impo: suggested, lines: [] });
    }

    groupMap.get(mapKey)!.lines.push({
      brand: row.brand || null,
      item_code: row.item_code,
      description: row.description || null,
      category: row.category || null,
      qty_incoming: row.qty,
    });
  }

  const groups: UploadPreviewGroup[] = Array.from(groupMap.values()).map((g) => ({
    eta: g.eta,
    suggestedImpoNumber: g.impo,
    lines: g.lines,
  }));

  return Response.json({ ok: true, groups, fileName });
}

// ── Confirm: save IMPOs + lines to DB ────────────────────────────────────────

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

  if (!payload.groups?.length) {
    return Response.json({ ok: false, error: "No groups provided." }, { status: 400 });
  }

  // Validate IMPO numbers are filled
  for (const g of payload.groups) {
    if (!g.impo_number?.trim()) {
      return Response.json({ ok: false, error: "All groups must have an IMPO number." }, { status: 400 });
    }
    if (!g.eta) {
      return Response.json({ ok: false, error: "All groups must have an ETA date." }, { status: 400 });
    }
  }

  let savedImpos = 0;
  let savedLines = 0;

  for (const group of payload.groups) {
    // Upsert IMPO (by impo_number — idempotent re-upload)
    const { data: impoData, error: impoErr } = await svc
      .from("impos")
      .upsert(
        {
          impo_number: group.impo_number.trim(),
          eta: group.eta,
          status: "pending",
          uploaded_by: auth!.uid,
          source_file_name: payload.source_file_name ?? null,
          total_skus: group.lines.length,
        },
        { onConflict: "impo_number" }
      )
      .select("id")
      .single();

    if (impoErr || !impoData) {
      return Response.json({ ok: false, error: `Failed to save IMPO ${group.impo_number}: ${impoErr?.message}` }, { status: 500 });
    }

    const impoId = (impoData as { id: string }).id;

    // Delete existing lines for this IMPO (re-upload replaces)
    await svc.from("impo_lines").delete().eq("impo_id", impoId);

    // Insert lines in batches of 100
    const lines = group.lines.map((l) => ({
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
        return Response.json({ ok: false, error: `Failed to save lines for IMPO ${group.impo_number}: ${lineErr.message}` }, { status: 500 });
      }
    }

    savedImpos++;
    savedLines += lines.length;
  }

  return Response.json({ ok: true, savedImpos, savedLines });
}

// ── Excel parser ──────────────────────────────────────────────────────────────

interface ParsedRow {
  impo_number: string | null;
  brand: string | null;
  item_code: string;
  description: string | null;
  category: string | null;
  qty: number;
  eta_raw: string | null;
  eta_iso: string | null;
}

function parseExcel(bytes: Uint8Array): ParsedRow[] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const ws = wb.Sheets[sheetName];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (raw.length < 2) throw new Error("Sheet appears empty.");

  // Find header row (first row with recognisable column names)
  const headerRow = (raw[0] as unknown[]).map((c) => String(c).trim().toLowerCase());

  const colIdx = (names: string[]) => {
    for (const n of names) {
      const i = headerRow.findIndex((h) => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const brandCol   = colIdx(["brand"]);
  const codeCol    = colIdx(["item code", "sku", "code", "model"]);
  const descCol    = colIdx(["description", "desc", "name"]);
  const catCol     = colIdx(["category", "cat"]);
  const qtyCol     = colIdx(["qty", "quantity"]);
  const etaCol     = colIdx(["eta", "arrival", "date"]);
  const impoCol    = colIdx(["impo"]);

  if (codeCol === -1) throw new Error("Could not find an Item Code column (looked for: item code, sku, code, model).");
  if (qtyCol  === -1) throw new Error("Could not find a Qty column (looked for: qty, quantity).");

  const rows: ParsedRow[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const code = String(row[codeCol] ?? "").trim();
    if (!code) continue;

    const qtyRaw = row[qtyCol];
    const qty = Number(qtyRaw);
    if (!qty || qty <= 0) continue;

    const etaRaw = etaCol !== -1 ? row[etaCol] : null;
    const { raw: etaRawStr, iso: etaIso } = parseEta(etaRaw);

    rows.push({
      impo_number: impoCol !== -1 ? String(row[impoCol] ?? "").trim() || null : null,
      brand:       brandCol !== -1 ? String(row[brandCol] ?? "").trim() || null : null,
      item_code:   code,
      description: descCol !== -1 ? String(row[descCol] ?? "").trim() || null : null,
      category:    catCol !== -1 ? String(row[catCol] ?? "").trim() || null : null,
      qty,
      eta_raw:     etaRawStr,
      eta_iso:     etaIso,
    });
  }

  return rows;
}

function parseEta(val: unknown): { raw: string | null; iso: string | null } {
  if (!val && val !== 0) return { raw: null, iso: null };

  // JS Date from cellDates:true
  if (val instanceof Date) {
    const iso = val.toISOString().slice(0, 10);
    return { raw: iso, iso };
  }

  const s = String(val).trim();
  if (!s) return { raw: null, iso: null };

  // Try ISO: 2026-07-03
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { raw: s, iso: s };

  // Try d/m/yyyy or d-m-yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return { raw: s, iso };
  }

  // Excel serial number
  const n = Number(s);
  if (!isNaN(n) && n > 40000) {
    const d = XLSX.SSF.parse_date_code(n);
    if (d) {
      const iso = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
      return { raw: s, iso };
    }
  }

  return { raw: s, iso: null };
}

function formatDateSlug(raw: string | null): string {
  if (!raw) return "TBD";
  // e.g. "2026-07-03" → "2607"
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1].slice(2)}${m[2]}`;
  return raw.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
}
