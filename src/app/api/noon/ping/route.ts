import { noonPing } from "@/lib/noon/client";
import { authorizeFinanceUser } from "@/lib/noon/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const userId = await authorizeFinanceUser(request);
  if (!userId) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const ping = await noonPing();
  return Response.json(ping);
}
