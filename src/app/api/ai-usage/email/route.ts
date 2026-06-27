import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGraphToken } from "@/lib/amazon-ingest/graph";
import { moduleLabel } from "@/lib/aiUsage";
import type { AiUsageRow } from "@/lib/aiUsage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await sb.from("users").select("email, full_name, role").eq("id", user.id).single();
  const p = profile as { email?: string; full_name?: string; role?: string } | null;

  const body = await req.json() as { to?: string; fromIso?: string; toIso?: string; rows?: AiUsageRow[]; summary?: Record<string, unknown> };
  const to = typeof body.to === "string" && body.to.includes("@") ? body.to.trim() : p?.email ?? "";
  if (!to) return NextResponse.json({ error: "No recipient email." }, { status: 400 });

  const from = body.fromIso?.slice(0, 10) ?? "—";
  const to2 = body.toIso?.slice(0, 10) ?? "—";
  const rows: AiUsageRow[] = body.rows ?? [];
  const s = body.summary as { totalCalls?: number; totalCost?: number; totalInputTokens?: number; totalOutputTokens?: number; byModule?: { source: string; label: string; calls: number; cost: number }[] } | undefined;

  const modRows = (s?.byModule ?? []).map((m) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${m.label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${m.calls}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${m.cost.toFixed(4)}</td>
    </tr>`).join("");

  const detailRows = rows.slice(0, 100).map((r) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.created_at ? new Date(r.created_at).toLocaleString("en-GB") : "—"}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px">${moduleLabel(r.source)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:right">${r.input_tokens ?? 0}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:right">${r.output_tokens ?? 0}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:right">$${(r.cost_usd ?? 0).toFixed(5)}</td>
    </tr>`).join("");

  const html = `
<div style="font-family:system-ui,sans-serif;max-width:700px;margin:0 auto;color:#1e293b">
  <div style="background:linear-gradient(135deg,#6366f1,#7c3aed);padding:28px 32px;border-radius:12px 12px 0 0">
    <h1 style="margin:0;color:#fff;font-size:20px">🤖 AI Usage Report</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">Techniline Ops · ${from} to ${to2}</p>
  </div>

  <div style="background:#f8fafc;padding:24px 32px;display:flex;gap:16px">
    ${[
      ["Total calls", s?.totalCalls ?? 0, ""],
      ["Total cost", `$${(s?.totalCost ?? 0).toFixed(4)}`, "USD"],
      ["Input tokens", (s?.totalInputTokens ?? 0).toLocaleString(), ""],
      ["Output tokens", (s?.totalOutputTokens ?? 0).toLocaleString(), ""],
    ].map(([label, value, unit]) => `
      <div style="background:#fff;border-radius:8px;padding:14px 18px;flex:1;border:1px solid #e2e8f0;text-align:center">
        <p style="margin:0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#64748b">${label}</p>
        <p style="margin:6px 0 2px;font-size:22px;font-weight:700;color:#1e293b">${value}</p>
        ${unit ? `<p style="margin:0;font-size:11px;color:#94a3b8">${unit}</p>` : ""}
      </div>`).join("")}
  </div>

  <div style="padding:24px 32px;background:#fff">
    <h2 style="margin:0 0 12px;font-size:15px;color:#374151">Breakdown by Module</h2>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b">Module</th>
        <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b">Calls</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b">Cost (USD)</th>
      </tr></thead>
      <tbody>${modRows}</tbody>
    </table>
  </div>

  ${rows.length > 0 ? `
  <div style="padding:0 32px 24px;background:#fff">
    <h2 style="margin:0 0 12px;font-size:15px;color:#374151">Recent Calls (up to 100)</h2>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#64748b">Time</th>
        <th style="padding:6px 10px;text-align:left;font-size:11px;color:#64748b">Module</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#64748b">In tokens</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#64748b">Out tokens</th>
        <th style="padding:6px 10px;text-align:right;font-size:11px;color:#64748b">Cost</th>
      </tr></thead>
      <tbody>${detailRows}</tbody>
    </table>
    ${rows.length > 100 ? `<p style="margin:8px 0 0;font-size:11px;color:#94a3b8">+ ${rows.length - 100} more rows — export CSV for the full list.</p>` : ""}
  </div>` : ""}

  <div style="padding:16px 32px;background:#f8fafc;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0">
    <p style="margin:0;font-size:11px;color:#94a3b8">Sent from Techniline Ops · ${new Date().toLocaleString("en-GB")} · ${p?.full_name ?? p?.email ?? "System"}</p>
  </div>
</div>`;

  try {
    const graphToken = await getGraphToken();
    const sender = p?.email ?? process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${graphToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `AI Usage Report · ${from} to ${to2}`,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `Graph ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sentTo: to });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Email failed." }, { status: 500 });
  }
}
