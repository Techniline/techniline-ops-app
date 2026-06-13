import { getGraphToken } from "@/lib/amazon-ingest/graph";
import { authorizeLogistics } from "@/lib/logistics/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Send a PRT request email via Graph. Caller supplies to/subject/body (plain text). */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeLogistics(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  let b: { to?: unknown; cc?: unknown; subject?: unknown; body?: unknown; html?: unknown };
  try {
    b = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const to = typeof b.to === "string" && b.to.includes("@") ? b.to.trim() : "";
  const subject = typeof b.subject === "string" && b.subject ? b.subject : "PRT Request";
  const html = typeof b.html === "string" && b.html.trim() ? b.html : "";
  const body = typeof b.body === "string" ? b.body : "";
  if (!to) return Response.json({ ok: false, error: "Enter a valid recipient email." }, { status: 400 });
  if (!html && !body) return Response.json({ ok: false, error: "Empty email body." }, { status: 400 });

  // CC: caller-provided addresses + always purchasing@techniline.org, deduped,
  // never duplicating the To recipient.
  const ALWAYS_CC = "purchasing@techniline.org";
  const rawCc = typeof b.cc === "string" ? b.cc.split(/[,;\s]+/) : Array.isArray(b.cc) ? (b.cc as unknown[]) : [];
  const ccSet = new Set<string>([ALWAYS_CC]);
  for (const c of rawCc) if (typeof c === "string" && c.includes("@")) ccSet.add(c.trim());
  ccSet.delete(to);
  const ccRecipients = [...ccSet].map((address) => ({ emailAddress: { address } }));

  // Send as the logged-in user, falling back to the configured default.
  const sender = auth.email ?? process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
  try {
    const token = await getGraphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: html ? { contentType: "HTML", content: html } : { contentType: "Text", content: body },
          toRecipients: [{ emailAddress: { address: to } }],
          ccRecipients,
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return Response.json({ ok: false, error: `Graph sendMail ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    return Response.json({ ok: true, sentTo: to });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Email send failed." }, { status: 500 });
  }
}
