import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";

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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { id?: string };
  if (!body.id) return NextResponse.json({ error: "Missing break id." }, { status: 400 });

  const now = new Date().toISOString();
  const { error } = await sb.from("user_breaks")
    .update({ ended_at: now, ended_by: "manual" })
    .eq("id", body.id)
    .eq("user_id", user.id)
    .is("ended_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
