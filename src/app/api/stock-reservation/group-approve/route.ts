import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import {
  getUserEmailById,
  sendStockEmail,
} from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LineDecision {
  reservation_id: string;
  action: "approve" | "reject";
  qty_approved?: number;
}

interface GroupApproveBody {
  group_id: string;
  decisions: LineDecision[];
  grace_notes?: string;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request, true);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = auth.serviceClient as any;

  let body: GroupApproveBody;
  try {
    body = await request.json() as GroupApproveBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { group_id, decisions, grace_notes } = body;
  if (!group_id) return Response.json({ ok: false, error: "group_id required." }, { status: 400 });
  if (!decisions?.length) return Response.json({ ok: false, error: "decisions required." }, { status: 400 });

  // Verify all reservations belong to this group and are pending
  const { data: groupRows, error: fetchErr } = await svc
    .from("stock_reservations")
    .select("id, status, qty_requested, impo_line_id, requested_by")
    .eq("group_id", group_id)
    .in("id", decisions.map((d: LineDecision) => d.reservation_id));

  if (fetchErr) return Response.json({ ok: false, error: fetchErr.message }, { status: 500 });

  const rowMap = new Map<string, { status: string; qty_requested: number; impo_line_id: string; requested_by: string }>(
    (groupRows as { id: string; status: string; qty_requested: number; impo_line_id: string; requested_by: string }[])
      .map((r) => [r.id, r])
  );

  const errors: string[] = [];

  for (const d of decisions) {
    const row = rowMap.get(d.reservation_id);
    if (!row) { errors.push(`${d.reservation_id}: not found in group`); continue; }
    if (row.status !== "pending") { errors.push(`${d.reservation_id}: already ${row.status}`); continue; }

    if (d.action === "approve") {
      const approvedQty = d.qty_approved ?? row.qty_requested;

      // Check availability excluding this reservation
      const { data: line } = await svc.from("impo_lines").select("qty_incoming").eq("id", row.impo_line_id).single();
      const { data: existing } = await svc
        .from("stock_reservations")
        .select("qty_requested")
        .eq("impo_line_id", row.impo_line_id)
        .in("status", ["pending", "approved"])
        .neq("id", d.reservation_id);

      const alreadyReserved = ((existing ?? []) as { qty_requested: number }[]).reduce((s, r) => s + r.qty_requested, 0);
      const lineQty = (line as { qty_incoming: number } | null)?.qty_incoming ?? 0;
      const available = lineQty - alreadyReserved;

      if (approvedQty > available) {
        errors.push(`${d.reservation_id}: only ${available} unit(s) available`);
        continue;
      }

      await svc.from("stock_reservations").update({
        status: "approved",
        qty_approved: approvedQty,
        grace_notes: grace_notes ?? null,
        reviewed_by: auth.uid,
        reviewed_at: new Date().toISOString(),
      }).eq("id", d.reservation_id);
    } else {
      await svc.from("stock_reservations").update({
        status: "rejected",
        grace_notes: grace_notes ?? null,
        reviewed_by: auth.uid,
        reviewed_at: new Date().toISOString(),
      }).eq("id", d.reservation_id);
    }
  }

  // Compute and update group status
  const { data: allGroupLines } = await svc
    .from("stock_reservations")
    .select("status")
    .eq("group_id", group_id);

  const statuses = ((allGroupLines ?? []) as { status: string }[]).map((r) => r.status).filter((s) => s !== "cancelled");
  let groupStatus = "pending";
  if (statuses.every((s) => s === "approved")) groupStatus = "approved";
  else if (statuses.every((s) => s === "rejected")) groupStatus = "rejected";
  else if (statuses.some((s) => s === "approved" || s === "rejected")) groupStatus = "partial";

  await svc.from("reservation_groups").update({
    status: groupStatus,
    reviewed_at: new Date().toISOString(),
    reviewed_by: auth.uid,
  }).eq("id", group_id);

  // Mark any email tokens for lines in this group as used
  await svc
    .from("stock_reservation_email_tokens")
    .update({ used_at: new Date().toISOString() })
    .in("reservation_id", decisions.map((d: LineDecision) => d.reservation_id))
    .is("used_at", null);

  // Notify salesperson
  after(() => notifyGroupSalesperson(auth.serviceClient, group_id, grace_notes ?? null, auth.uid));

  return Response.json({
    ok: true,
    group_status: groupStatus,
    ...(errors.length > 0 ? { warnings: errors } : {}),
  });
}

async function notifyGroupSalesperson(
  svc: SupabaseClient,
  groupId: string,
  graceNotes: string | null,
  approverUid?: string
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svcAny = svc as any;

    const [{ data: grpData }, { data: resRows }] = await Promise.all([
      svcAny.from("reservation_groups").select("*, requester:users!requested_by(full_name)").eq("id", groupId).single(),
      svcAny.from("stock_reservations")
        .select("id, status, qty_requested, qty_approved, impo_line:impo_lines(item_code, brand, description, impo:impos(impo_number, eta))")
        .eq("group_id", groupId),
    ]);

    if (!grpData) return;

    const grp = grpData as Record<string, unknown>;
    const requesterUid = grp.requested_by as string;
    const [requesterEmail, approverEmail, approverProfile] = await Promise.all([
      getUserEmailById(svc, requesterUid),
      approverUid ? getUserEmailById(svc, approverUid) : Promise.resolve(null),
      approverUid ? svcAny.from("users").select("full_name").eq("id", approverUid).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (!requesterEmail) return;
    const approverName = (approverProfile.data as { full_name?: string } | null)?.full_name ?? "Manager";

    const requesterName = (grp.requester as { full_name?: string } | null)?.full_name ?? "Salesperson";
    const groupStatus = grp.status as string;
    const customerRef = grp.customer_ref as string;

    const fmtDate = (iso: string | null) => {
      if (!iso) return "—";
      try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; }
    };

    const esc = (v: string | null | undefined) => {
      if (!v) return "—";
      return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };

    type ResRow = { id: string; status: string; qty_requested: number; qty_approved: number | null; impo_line: Record<string, unknown> | null };
    const rows = (resRows ?? []) as ResRow[];

    const isFullyApproved = groupStatus === "approved";
    const isFullyRejected = groupStatus === "rejected";
    const headerGrad = isFullyApproved
      ? "linear-gradient(135deg,#059669 0%,#10b981 100%)"
      : isFullyRejected
      ? "linear-gradient(135deg,#be123c 0%,#f43f5e 100%)"
      : "linear-gradient(135deg,#d97706 0%,#f59e0b 100%)";
    const statusEmoji = isFullyApproved ? "&#9989;" : isFullyRejected ? "&#10060;" : "&#9203;";
    const statusTitle = isFullyApproved ? "Order Approved" : isFullyRejected ? "Order Rejected" : "Order Partially Approved";
    const statusSub = isFullyApproved
      ? `Your order for <strong>${customerRef}</strong> has been fully approved.`
      : isFullyRejected
      ? `Your order for <strong>${customerRef}</strong> was not approved.`
      : `Your order for <strong>${customerRef}</strong> was partially approved — see details below.`;

    const lineTableRows = rows.map((r, i) => {
      const il = (r.impo_line as Record<string, unknown> | null) ?? {};
      const im = (il.impo as Record<string, unknown> | null) ?? {};
      const statusStyle = r.status === "approved"
        ? "background:#d1fae5;color:#065f46;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700"
        : r.status === "rejected"
        ? "background:#fee2e2;color:#991b1b;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700"
        : "background:#fef3c7;color:#92400e;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700";
      const qtyCell = r.status === "approved" && r.qty_approved !== null && r.qty_approved !== r.qty_requested
        ? `<strong style="color:#059669">${r.qty_approved}</strong> <span style="color:#94a3b8;font-size:11px">of ${r.qty_requested}</span>`
        : r.status === "approved"
        ? `<strong style="color:#059669">${r.qty_approved ?? r.qty_requested}</strong>`
        : `<span style="color:#94a3b8">${r.qty_requested}</span>`;
      const bg = i % 2 === 0 ? "background:#f8fafc;" : "background:#fff;";
      return `<tr style="${bg}">
        <td style="padding:9px 14px;font-size:12px;font-family:'Courier New',monospace;border-bottom:1px solid #eef2f7">${esc(il.item_code as string)}</td>
        <td style="padding:9px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #eef2f7">${esc(il.brand as string | null)}</td>
        <td style="padding:9px 14px;font-size:12px;text-align:center;border-bottom:1px solid #eef2f7">${esc(im.impo_number as string)}<br/><span style="font-size:11px;color:#94a3b8">${fmtDate(im.eta as string | null)}</span></td>
        <td style="padding:9px 14px;font-size:13px;text-align:right;border-bottom:1px solid #eef2f7">${qtyCell}</td>
        <td style="padding:9px 14px;text-align:center;border-bottom:1px solid #eef2f7"><span style="${statusStyle}">${r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span></td>
      </tr>`;
    }).join("");

    const APP_URL_LOCAL = "https://techniline-ops-app.vercel.app";

    const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:660px;margin:0 auto;color:#1e293b;background:#f8fafc">
  <div style="background:${headerGrad};padding:40px 36px;border-radius:16px 16px 0 0;text-align:center">
    <div style="font-size:46px;line-height:1;margin-bottom:14px">${statusEmoji}</div>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-.4px">${statusTitle}</h1>
    <p style="margin:10px auto 0;color:rgba(255,255,255,.82);font-size:13px;max-width:380px;line-height:1.5">${statusSub}</p>
  </div>
  <div style="background:#fff;padding:28px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8">Order Lines</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left">SKU</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left">Brand</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:center">IMPO / ETA</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:right">Qty</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:center">Status</th>
      </tr></thead>
      <tbody>${lineTableRows}</tbody>
    </table>
    ${graceNotes ? `<p style="margin:14px 0 0;font-size:12px;color:#475569;font-style:italic">Reviewer's notes: ${esc(graceNotes)}</p>` : ""}
  </div>
  <div style="background:#f8fafc;padding:24px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <a href="${APP_URL_LOCAL}/stock-reservation" style="display:inline-block;padding:13px 30px;background:#4f46e5;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">View My Reservations &rarr;</a>
  </div>
  <div style="background:#f1f5f9;padding:14px 36px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation System</p>
  </div>
</div>`;

    const totalLines = rows.length;
    const approvedLines = rows.filter((r) => r.status === "approved").length;
    const subject = isFullyApproved
      ? `✅ Order Approved — ${customerRef} · ${totalLines} lines`
      : isFullyRejected
      ? `❌ Order Rejected — ${customerRef} · ${totalLines} lines`
      : `⚠️ Order Partially Approved — ${customerRef} · ${approvedLines}/${totalLines} lines approved`;

    await sendStockEmail(requesterEmail, subject, html, {
      fromName: approverName,
      replyTo: approverEmail ? { address: approverEmail, name: approverName } : undefined,
      bcc: approverEmail ?? undefined,
    });
  } catch (e) {
    console.error("[group-approve] salesperson notification failed:", e);
  }
}
