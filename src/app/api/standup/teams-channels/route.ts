import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sbFromReq(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: token ? { Authorization: `Bearer ${token}` } : {} } }
  );
}

export interface SavedChannel {
  id: string;
  name: string;
  team_id: string;
  channel_id: string;
}

/** GET /api/standup/teams-channels  — returns saved channels for the manager. */
export async function GET(req: NextRequest) {
  const sb = sbFromReq(req) as any;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await sb
    .from("standup_channels")
    .select("id, name, team_id, channel_id")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channels: data ?? [] });
}

/** POST /api/standup/teams-channels  — save a new channel. Body: { name, team_id, channel_id } */
export async function POST(req: NextRequest) {
  const sb = sbFromReq(req) as any;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, team_id, channel_id } = body as { name: string; team_id: string; channel_id: string };
  if (!name || !team_id || !channel_id) {
    return NextResponse.json({ error: "Missing name, team_id, or channel_id" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("standup_channels")
    .upsert({ name, team_id, channel_id }, { onConflict: "team_id,channel_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channel: data });
}

/** DELETE /api/standup/teams-channels?id=... */
export async function DELETE(req: NextRequest) {
  const sb = sbFromReq(req) as any;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await sb.from("standup_channels").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
