import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const AARON_ID = "cbb81b27-8756-4f2d-bfe0-04211c27092c";

export async function GET(req: NextRequest) {
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

  // Aaron reads his own; manager reads Aaron's
  const targetId = user.id === AARON_ID ? AARON_ID : AARON_ID;

  // Only Aaron or managers can call this
  if (user.id !== AARON_ID) {
    const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single();
    if ((profile as { role?: string } | null)?.role !== "manager")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { data } = await sb
    .from("user_breaks")
    .select("*")
    .eq("user_id", targetId)
    .is("ended_at", null)
    .gt("expected_end_at", now)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ break: data ?? null });
}
