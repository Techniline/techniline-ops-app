import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGraphToken } from "@/lib/amazon-ingest/graph";

function sbFromReq(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: token ? { Authorization: `Bearer ${token}` } : {} } }
  );
}

/** Convert the plain-text standup summary (WhatsApp format) to Teams-flavoured HTML. */
function toTeamsHtml(text: string): string {
  const lines = text.split("\n");
  const html: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { html.push("<br>"); continue; }

    // Horizontal rule
    if (/^─+$/.test(line)) { html.push("<hr>"); continue; }

    // Bold lines (*...*) — headings
    const boldFull = line.match(/^\*(.+)\*$/);
    if (boldFull) {
      html.push(`<b>${escHtml(boldFull[1])}</b>`);
      continue;
    }

    // Bullet lines
    if (line.startsWith("• ")) {
      const content = line.slice(2);
      // Inline *bold* and _italic_
      html.push(`<li>${inlineFormat(content)}</li>`);
      continue;
    }

    // Indented detail (starts with space + _..._)
    if (line.startsWith("_") && line.endsWith("_")) {
      html.push(`<span style="color:#666;font-size:0.9em">${escHtml(line.slice(1, -1))}</span>`);
      continue;
    }

    html.push(inlineFormat(line));
  }

  return html.join("\n");
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineFormat(s: string): string {
  // *bold* → <b>
  let out = escHtml(s);
  out = out.replace(/\*([^*]+)\*/g, "<b>$1</b>");
  out = out.replace(/_([^_]+)_/g, "<i>$1</i>");
  return out;
}

/** POST /api/standup/share-teams
 *  Body: { teamId, channelId, summaryText }
 *  Requires ChannelMessage.Send application permission in Azure.
 */
export async function POST(req: NextRequest) {
  const sb = sbFromReq(req) as any;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { teamId, channelId, summaryText, channelName } = body as {
    teamId: string;
    channelId: string;
    summaryText: string;
    channelName?: string;
  };

  if (!teamId || !channelId || !summaryText) {
    return NextResponse.json({ error: "Missing teamId, channelId, or summaryText" }, { status: 400 });
  }

  try {
    const token = await getGraphToken();

    const messageBody = toTeamsHtml(summaryText);

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: {
            contentType: "html",
            content: messageBody,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      if (res.status === 403) {
        return NextResponse.json({
          error: "Cannot post to Teams. Add ChannelMessage.Send application permission to the Azure app registration.",
          code: "GRAPH_PERMISSIONS_MISSING",
        }, { status: 403 });
      }
      return NextResponse.json({ error: `Graph error ${res.status}: ${err.slice(0, 300)}` }, { status: 500 });
    }

    const json = await res.json();
    return NextResponse.json({ ok: true, messageId: json.id, channel: channelName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Azure Graph env not configured")) {
      return NextResponse.json({
        error: "Azure credentials not configured.",
        code: "AZURE_NOT_CONFIGURED",
      }, { status: 503 });
    }
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
