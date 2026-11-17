import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const AARON_ID   = "cbb81b27-8756-4f2d-bfe0-04211c27092c";
const MARICEL_ID = "227fdb27-80b5-4040-ab14-4bb945068af7";
const ALLOWED_USERS = new Set([AARON_ID, MARICEL_ID]);

function sbFromReq(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: token ? { Authorization: `Bearer ${token}` } : {} } }
  );
}

/** GET /api/standup?date=YYYY-MM-DD&userId=...
 *  Returns the standup log. Managers can query any user; others only themselves.
 */
export async function GET(req: NextRequest) {
  const sb = sbFromReq(req) as any;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
  const manager = (profile as { role?: string } | null)?.role === "manager";

  const date   = req.nextUrl.searchParams.get("date");
  const userId = req.nextUrl.searchParams.get("userId") ?? user.id;

  if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });
  if (!manager && userId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await sb.from("standup_logs").select("*").eq("user_id", userId).eq("log_date", date).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** POST /api/standup  — upsert own log. Only Aaron and Maricel can submit. */
export async function POST(req: NextRequest) {
  const sb = sbFromReq(req) as any;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_USERS.has(user.id)) return NextResponse.json({ error: "Only standup users can submit" }, { status: 403 });

  const body = await req.json();
  const { log_date, yesterday_items, today_items, blocker_items } = body;
  if (!log_date) return NextResponse.json({ error: "Missing log_date" }, { status: 400 });

  const { data, error } = await sb
    .from("standup_logs")
    .upsert(
      {
        user_id: user.id,
        log_date,
        yesterday_items: yesterday_items ?? [],
        today_items: today_items ?? [],
        blocker_items: blocker_items ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,log_date" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
