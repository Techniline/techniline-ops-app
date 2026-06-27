import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";
const BREAK_DURATION: Record<string, number> = { short: 15, lunch: 60 };

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
  if (!user || user.id !== AARON_ID)
    return NextResponse.json({ error: "Only Aaron can start breaks." }, { status: 403 });

  const body = await req.json() as { type?: string };
  const type = body.type as "short" | "lunch";
  if (!["short", "lunch"].includes(type))
    return NextResponse.json({ error: "Invalid break type." }, { status: 400 });

  const startedAt = new Date();
  const expectedEnd = new Date(startedAt.getTime() + BREAK_DURATION[type] * 60_000);

  const { data, error } = await sb.from("user_breaks").insert({
    user_id: user.id,
    type,
    started_at: startedAt.toISOString(),
    expected_end_at: expectedEnd.toISOString(),
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ break: data });
}
