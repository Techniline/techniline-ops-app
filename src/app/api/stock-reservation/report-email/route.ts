import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import { sendStockEmail } from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let body: { to: string; cc?: string; subject: string; html: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { to, cc, subject, html } = body;
  if (!to || !subject || !html) {
    return Response.json({ ok: false, error: "to, subject, and html are required." }, { status: 400 });
  }

  try {
    await sendStockEmail(to, subject, html, {
      fromName: "Techniline Stock Reports",
      cc: cc || undefined,
    });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send email.";
    console.error("[report-email] send failed:", msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
