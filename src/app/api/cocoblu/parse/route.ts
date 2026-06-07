import { createClient } from "@supabase/supabase-js";

import { parseInvoicePdf } from "@/lib/cocoblu/parseInvoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verify the caller's Supabase session token; returns the user id or null. */
async function authedUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/**
 * Auto-capture a Cocoblu invoice from an uploaded PDF. Returns a draft for the
 * user to verify/edit before saving — this endpoint performs NO database write.
 * Authenticated app users only (the extraction call costs money).
 */
export async function POST(request: Request): Promise<Response> {
  const userId = await authedUserId(request);
  if (!userId) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let bytes: Uint8Array;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "No PDF file provided." }, { status: 400 });
    }
    if (file.size > 15_000_000) {
      return Response.json({ ok: false, error: "File too large (max 15 MB)." }, { status: 413 });
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return Response.json({ ok: false, error: "Could not read the upload." }, { status: 400 });
  }

  try {
    const draft = await parseInvoicePdf(bytes);
    return Response.json({ ok: true, draft });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to parse the invoice." },
      { status: 500 }
    );
  }
}
