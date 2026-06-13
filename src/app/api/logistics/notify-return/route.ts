import { getGraphToken } from "@/lib/amazon-ingest/graph";
import { authorizeLogistics } from "@/lib/logistics/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";

/** Email Maricel that a marketplace return was logged and needs documentation. */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let b: { summary?: unknown };
  try {
    b = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const summary = typeof b.summary === "string" ? b.summary : "";

  // Look up Maricel's mailbox.
  const { data: row } = await auth.serviceClient.from("users").select("email").eq("id", MARICEL_ID).maybeSingle();
  const to = (row as { email?: string } | null)?.email;
  if (!to) return Response.json({ ok: false, error: "Recipient not found." }, { status: 404 });

  const sender = auth.email ?? process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <p>A marketplace return has been logged in the warehouse and needs documentation.</p>
    <p style="background:#f8fafc;border-left:3px solid #4f46e5;padding:10px 14px">${summary || "New return logged."}</p>
    <p>Open <strong>Logistics → Marketplace Returns</strong> and complete the documentation (credit note, SRT/PRT, dispute/case IDs).</p>
    <p style="color:#64748b;font-size:12px">Techniline Logistics</p>
  </div>`;
  try {
    const token = await getGraphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: "Marketplace return — documentation needed",
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return Response.json({ ok: false, error: `Graph sendMail ${res.status}: ${t.slice(0, 160)}` }, { status: 502 });
    }
    return Response.json({ ok: true, sentTo: to });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Email failed." }, { status: 500 });
  }
}
