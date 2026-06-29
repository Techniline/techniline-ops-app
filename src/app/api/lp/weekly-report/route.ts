import { createClient } from "@supabase/supabase-js";

import { getGraphToken } from "@/lib/amazon-ingest/graph";
import { renderTableReportHtml } from "@/lib/export";
import type { LpItemRow } from "@/lib/lp/queries";
import { stockInHandReport } from "@/lib/lp/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Weekly LP stock-in-hand report recipient(s). impex@ = Mr. Pavithran. */
const RECIPIENTS = ["impex@techniline.org"];

/**
 * Vercel Cron (weekly) → build the LP stock-in-hand report server-side and email
 * it to Pavithran via Microsoft Graph. Armed by CRON_SECRET. A Monday guard
 * keeps it weekly even if the platform fires the schedule daily; `?force=1`
 * bypasses the guard for a manual test.
 */
export async function GET(request: Request): Promise<Response> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return Response.json({ ok: false, error: "Server DB not configured." }, { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && new Date().getUTCDay() !== 1) {
    return Response.json({ ok: true, skipped: "not Monday" });
  }

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await svc.from("lp_items_view").select("*").limit(20000);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const table = stockInHandReport((data ?? []) as LpItemRow[], new Date().toISOString());
  const html = renderTableReportHtml(table);

  try {
    const gtoken = await getGraphToken();
    const sender = process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gtoken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `LP Stock in Hand — weekly (${new Date().toLocaleDateString("en-GB")})`,
          body: { contentType: "HTML", content: html },
          toRecipients: RECIPIENTS.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return Response.json({ ok: false, error: `Graph sendMail ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    return Response.json({ ok: true, sentTo: RECIPIENTS, lines: table.rows.length });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Email send failed." }, { status: 500 });
  }
}
