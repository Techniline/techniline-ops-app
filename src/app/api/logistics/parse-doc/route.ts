import { authorizeLogistics } from "@/lib/logistics/serverAuth";
import { parseLogisticsDoc } from "@/lib/logistics/parseDoc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Auto-capture a Techniline invoice OR delivery note (DO) from an uploaded PDF.
 * Returns a unified draft for the user to verify — no database write.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let bytes: Uint8Array;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "No PDF file provided." }, { status: 400 });
    if (file.size > 15_000_000) return Response.json({ ok: false, error: "File too large (max 15 MB)." }, { status: 413 });
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return Response.json({ ok: false, error: "Could not read the upload." }, { status: 400 });
  }

  try {
    const draft = await parseLogisticsDoc(bytes);
    return Response.json({ ok: true, draft });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to parse the document." },
      { status: 500 }
    );
  }
}
