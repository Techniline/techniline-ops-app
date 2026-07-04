import { createClient } from "@supabase/supabase-js";

import { getUserEmailById, sendStockEmail, GRACE_UID } from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function esc(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── GET /api/cron/eta-reminder — daily digest for Grace of IMPOs arriving in ≤3 days ──

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createClient(url, service, { auth: { persistSession: false } }) as any;

  const today = new Date();
  const in3 = new Date(today);
  in3.setDate(today.getDate() + 3);
  const todayStr = today.toISOString().slice(0, 10);
  const in3Str   = in3.toISOString().slice(0, 10);

  // IMPOs arriving within 3 days that are still active
  const { data: impos } = await svc
    .from("impos")
    .select("id, impo_number, eta, status, total_skus")
    .in("status", ["pending", "in_transit"])
    .gte("eta", todayStr)
    .lte("eta", in3Str)
    .order("eta", { ascending: true });

  if (!impos?.length) {
    if (force) return Response.json({ ok: true, message: "No IMPOs arriving in the next 3 days." });
    return Response.json({ ok: true, skipped: "no upcoming IMPOs" });
  }

  // For each IMPO, get reservation summary
  type ImpoRow = { id: string; impo_number: string; eta: string | null; status: string; total_skus: number };
  type ResRow = {
    id: string; impo_line_id: string; status: string; qty_requested: number; qty_approved: number | null;
    customer_ref: string | null; requester: { full_name?: string } | null;
    impo_line: { item_code?: string } | null;
  };

  const impoIds = (impos as ImpoRow[]).map((i) => i.id);

  const { data: lineRows } = await svc
    .from("impo_lines")
    .select("id, impo_id")
    .in("impo_id", impoIds);

  const lineIds = ((lineRows ?? []) as { id: string; impo_id: string }[]).map((l) => l.id);

  const { data: reservations } = lineIds.length
    ? await svc
        .from("stock_reservations")
        .select("id, impo_line_id, status, qty_requested, qty_approved, customer_ref, requester:users!requested_by(full_name), impo_line:impo_lines(item_code)")
        .in("impo_line_id", lineIds)
        .in("status", ["pending", "approved"])
    : { data: [] };

  // Group reservations by impo_id
  const lineImpoMap = new Map<string, string>(
    ((lineRows ?? []) as { id: string; impo_id: string }[]).map((l) => [l.id, l.impo_id])
  );
  const resByImpo = new Map<string, { pending: ResRow[]; approved: ResRow[] }>();
  for (const r of (reservations ?? []) as ResRow[]) {
    const impoId = lineImpoMap.get(r.impo_line_id);
    if (!impoId) continue;
    if (!resByImpo.has(impoId)) resByImpo.set(impoId, { pending: [], approved: [] });
    if (r.status === "pending") resByImpo.get(impoId)!.pending.push(r);
    else if (r.status === "approved") resByImpo.get(impoId)!.approved.push(r);
  }

  // Build HTML email
  const impoSections = (impos as ImpoRow[]).map((impo) => {
    const res = resByImpo.get(impo.id) ?? { pending: [], approved: [] };
    const daysUntil = Math.round((new Date(impo.eta!).getTime() - today.getTime()) / 86_400_000);
    const urgencyColor = daysUntil === 0 ? "#dc2626" : daysUntil === 1 ? "#d97706" : "#0891b2";
    const urgencyLabel = daysUntil === 0 ? "TODAY" : daysUntil === 1 ? "TOMORROW" : `IN ${daysUntil} DAYS`;

    const approvedRows = res.approved.map((r, i) => {
      const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      const sku = (r.impo_line as { item_code?: string } | null)?.item_code ?? "—";
      return `<tr style="background:${bg}">
        <td style="padding:7px 12px;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9">${esc(r.requester?.full_name)}</td>
        <td style="padding:7px 12px;font-family:'Courier New',monospace;font-size:11px;color:#334155;border-bottom:1px solid #f1f5f9">${esc(sku)}</td>
        <td style="padding:7px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #f1f5f9">${esc(r.customer_ref)}</td>
        <td style="padding:7px 12px;font-size:12px;font-weight:700;color:#059669;text-align:right;border-bottom:1px solid #f1f5f9">${r.qty_approved ?? r.qty_requested}</td>
      </tr>`;
    }).join("");

    return `<div style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
        <div>
          <span style="font-family:'Courier New',monospace;font-size:14px;font-weight:700;color:#1e293b">${esc(impo.impo_number)}</span>
          <span style="margin-left:12px;font-size:12px;color:#64748b">ETA ${fmtDate(impo.eta)} &middot; ${impo.total_skus} SKU${impo.total_skus !== 1 ? "s" : ""}</span>
        </div>
        <span style="font-size:11px;font-weight:800;color:${urgencyColor};letter-spacing:.06em">${urgencyLabel}</span>
      </div>
      <div style="padding:10px 16px;background:#fff;display:flex;gap:24px">
        <div style="text-align:center">
          <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8">Approved</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#059669">${res.approved.length}</p>
        </div>
        <div style="text-align:center">
          <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8">Pending</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#d97706">${res.pending.length}</p>
        </div>
      </div>
      ${res.approved.length > 0 ? `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left">Salesperson</th>
            <th style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left">SKU</th>
            <th style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left">Customer</th>
            <th style="padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:right">Qty</th>
          </tr>
        </thead>
        <tbody>${approvedRows}</tbody>
      </table>` : `<p style="padding:10px 16px;font-size:12px;color:#94a3b8;margin:0">No approved reservations on this shipment.</p>`}
      ${res.pending.length > 0 ? `<div style="padding:8px 16px;background:#fef3c7;border-top:1px solid #fde68a"><p style="margin:0;font-size:12px;color:#92400e">⚠ ${res.pending.length} pending request${res.pending.length !== 1 ? "s" : ""} — approve or reject before shipment arrives.</p></div>` : ""}
    </div>`;
  }).join("");

  const APP_URL = "https://techniline-ops-app.vercel.app";
  const reportDate = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#1e293b;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#0891b2 0%,#06b6d4 100%);padding:28px 32px;border-radius:16px 16px 0 0">
    <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.65)">Techniline Ops</p>
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:-.3px">Shipment ETA Digest</h1>
    <p style="margin:5px 0 0;font-size:13px;color:rgba(255,255,255,.75)">${(impos as ImpoRow[]).length} shipment${(impos as ImpoRow[]).length !== 1 ? "s" : ""} arriving in the next 3 days &middot; ${reportDate}</p>
  </div>
  <div style="background:#fff;padding:24px 28px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    ${impoSections}
  </div>
  <div style="background:#f8fafc;padding:18px 28px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <a href="${APP_URL}/stock-reservation/manager?tab=impos" style="display:inline-block;padding:12px 28px;background:#0891b2;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">Open Manager Dashboard &rarr;</a>
  </div>
  <div style="background:#f1f5f9;padding:12px 28px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation &middot; Daily ETA Reminder</p>
  </div>
</div>`;

  const graceEmail = await getUserEmailById(svc, GRACE_UID);
  if (!graceEmail) return Response.json({ ok: false, error: "Could not resolve Grace's email." }, { status: 500 });

  await sendStockEmail(
    graceEmail,
    `📦 ETA Digest — ${(impos as ImpoRow[]).length} shipment${(impos as ImpoRow[]).length !== 1 ? "s" : ""} arriving soon`,
    html,
    { fromName: "Techniline Ops" }
  );

  return Response.json({ ok: true, impos: (impos as ImpoRow[]).length });
}
