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

export interface TeamsChannel {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
}

/** GET /api/standup/teams-channels
 *  Returns all Teams channels the app can see.
 *  Requires Channel.ReadBasic.All + Team.ReadBasic.All app permissions in Azure.
 */
export async function GET(req: NextRequest) {
  const sb = sbFromReq(req) as any;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const token = await getGraphToken();

    // List all teams joined by the app service account
    const teamsRes = await fetch(
      "https://graph.microsoft.com/v1.0/teams?$select=id,displayName&$top=50",
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!teamsRes.ok) {
      const err = await teamsRes.text();
      // Provide a helpful message if permissions are missing
      if (teamsRes.status === 403) {
        return NextResponse.json({
          error: "Graph permissions not set up for Teams. Add Team.ReadBasic.All and Channel.ReadBasic.All to the Azure app registration.",
          code: "GRAPH_PERMISSIONS_MISSING",
        }, { status: 403 });
      }
      return NextResponse.json({ error: `Graph error ${teamsRes.status}: ${err.slice(0, 200)}` }, { status: 500 });
    }

    const teamsData = await teamsRes.json() as { value: { id: string; displayName: string }[] };
    const teams = teamsData.value ?? [];

    // Fetch channels for each team in parallel (cap at 20 teams to avoid timeouts)
    const results: TeamsChannel[] = [];
    await Promise.all(
      teams.slice(0, 20).map(async (team) => {
        const chRes = await fetch(
          `https://graph.microsoft.com/v1.0/teams/${team.id}/channels?$select=id,displayName&$top=50`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!chRes.ok) return;
        const chData = await chRes.json() as { value: { id: string; displayName: string }[] };
        for (const ch of chData.value ?? []) {
          results.push({
            teamId: team.id,
            teamName: team.displayName,
            channelId: ch.id,
            channelName: ch.displayName,
          });
        }
      })
    );

    return NextResponse.json({ channels: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Azure credentials not set up at all
    if (msg.includes("Azure Graph env not configured")) {
      return NextResponse.json({
        error: "Azure credentials not configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET).",
        code: "AZURE_NOT_CONFIGURED",
      }, { status: 503 });
    }
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
