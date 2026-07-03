import { createClient } from "@supabase/supabase-js";
import {
  GRACE_UID,
  getUserEmailById,
  sendStockEmail,
} from "@/lib/stock-reservation/emailService";
// GRACE_UID used as fallback when token has no reviewer_uid (legacy tokens)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeSvc() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false } });
}

function htmlPage(title: string, emoji: string, heading: string, body: string, color: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Techniline</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#fff;border-radius:20px;padding:52px 44px;max-width:460px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.09);text-align:center}.brand{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:22px}.icon{font-size:54px;line-height:1;margin-bottom:16px}h1{font-size:22px;font-weight:800;color:${color};margin-bottom:10px}p{font-size:14px;color:#64748b;line-height:1.65}.hint{margin-top:22px!important;font-size:12px;color:#94a3b8}</style></head><body><div class="card"><p class="brand">Techniline Ops</p><div class="icon">${emoji}</div><h1>${heading}</h1><p>${body}</p><p class="hint">You can close this tab.</p></div></body></html>`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; }
}

function esc(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(
      htmlPage("Invalid Link", "&#9888;&#65039;", "Invalid Link", "This action link is missing a token.", "#dc2626"),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const svc = makeSvc();
  if (!svc) {
    return new Response(
      htmlPage("Server Error", "&#9888;&#65039;", "Server Error", "The server is not configured correctly.", "#dc2626"),
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svcAny = svc as any;

  const { data: tokenRow, error: tokenErr } = await svcAny
    .from("stock_reservation_email_tokens")
    .select("id, reservation_id, action, expires_at, used_at, reviewer_uid")
    .eq("id", token)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    return new Response(
      htmlPage("Link Not Found", "&#10067;", "Link Not Found", "This action link is invalid or has expired.", "#dc2626"),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const t = tokenRow as {
    id: string;
    reservation_id: string;
    action: "approve" | "reject";
    expires_at: string;
    used_at: string | null;
    reviewer_uid: string | null;
  };
  const reviewerUid = t.reviewer_uid ?? GRACE_UID;

  if (t.used_at) {
    return new Response(
      htmlPage("Already Done", "&#9989;", "Already Done", "This action has already been taken. The salesperson has been notified.", "#6366f1"),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  if (new Date(t.expires_at) < new Date()) {
    return new Response(
      htmlPage("Link Expired", "&#9200;", "Link Expired", "This action link has expired (72 hours). Please use the Manager Dashboard to review this order.", "#f59e0b"),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  // Find the group_id via the anchor reservation
  const { data: anchorRes, error: anchorErr } = await svcAny
    .from("stock_reservations")
    .select("id, group_id, status")
    .eq("id", t.reservation_id)
    .single();

  if (anchorErr || !anchorRes) {
    return new Response(
      htmlPage("Not Found", "&#10067;", "Reservation Not Found", "The reservation could not be found.", "#dc2626"),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const anchor = anchorRes as { id: string; group_id: string | null; status: string };

  if (!anchor.group_id) {
    return new Response(
      htmlPage("Wrong Link", "&#9888;&#65039;", "Not a Group Order", "This link is for a group order, but the reservation has no group. Please use the Manager Dashboard.", "#f59e0b"),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  // Fetch all pending reservations in the group
  const { data: groupLines, error: linesErr } = await svcAny
    .from("stock_reservations")
    .select("id, status, qty_requested, impo_line_id")
    .eq("group_id", anchor.group_id)
    .eq("status", "pending");

  if (linesErr || !groupLines?.length) {
    return new Response(
      htmlPage("Already Processed", "&#9989;", "Already Processed", "All lines in this order have already been reviewed. No further action needed.", "#6366f1"),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  const action = t.action;
  const now = new Date().toISOString();

  if (action === "approve") {
    // Approve each line at full requested qty
    for (const line of groupLines as { id: string; qty_requested: number; impo_line_id: string }[]) {
      await svcAny
        .from("stock_reservations")
        .update({
          status: "approved",
          qty_approved: line.qty_requested,
          reviewed_by: reviewerUid,
          reviewed_at: now,
        })
        .eq("id", line.id)
        .eq("status", "pending");
    }
  } else {
    for (const line of groupLines as { id: string }[]) {
      await svcAny
        .from("stock_reservations")
        .update({
          status: "rejected",
          reviewed_by: reviewerUid,
          reviewed_at: now,
        })
        .eq("id", line.id)
        .eq("status", "pending");
    }
  }

  // Update group status
  const newGroupStatus = action === "approve" ? "approved" : "rejected";
  await svcAny
    .from("reservation_groups")
    .update({ status: newGroupStatus, reviewed_by: reviewerUid, reviewed_at: now })
    .eq("id", anchor.group_id);

  // Mark all tokens for these reservations used
  const lineIds = (groupLines as { id: string }[]).map((r) => r.id);
  await svcAny
    .from("stock_reservation_email_tokens")
    .update({ used_at: now })
    .in("reservation_id", lineIds)
    .is("used_at", null);

  // Notify salesperson
  await notifyGroupSalesperson(svc, anchor.group_id, action, reviewerUid);

  const isApproved = action === "approve";
  return new Response(
    htmlPage(
      isApproved ? "Order Approved" : "Order Rejected",
      isApproved ? "&#9989;" : "&#10060;",
      isApproved ? "Order Approved" : "Order Rejected",
      isApproved
        ? "All lines have been approved. The salesperson has been notified by email."
        : "All lines have been rejected. The salesperson has been notified by email.",
      isApproved ? "#059669" : "#dc2626"
    ),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

async function notifyGroupSalesperson(
  svc: ReturnType<typeof makeSvc>,
  groupId: string,
  action: "approve" | "reject",
  approverUid?: string
): Promise<void> {
  if (!svc) return;
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
    const [requesterEmail, approverEmail, approverProfile] = await Promise.all([
      getUserEmailById(svc, grp.requested_by as string),
      approverUid ? getUserEmailById(svc, approverUid) : Promise.resolve(null),
      approverUid ? svcAny.from("users").select("full_name").eq("id", approverUid).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (!requesterEmail) return;
    const approverName = (approverProfile.data as { full_name?: string } | null)?.full_name ?? "Manager";

    const requesterName = (grp.requester as { full_name?: string } | null)?.full_name ?? "Salesperson";
    const customerRef = grp.customer_ref as string;

    type ResRow = { id: string; status: string; qty_requested: number; qty_approved: number | null; impo_line: Record<string, unknown> | null };
    const rows = (resRows ?? []) as ResRow[];
    const isApproved = action === "approve";

    const headerGrad = isApproved
      ? "linear-gradient(135deg,#059669 0%,#10b981 100%)"
      : "linear-gradient(135deg,#be123c 0%,#f43f5e 100%)";

    const lineTableRows = rows.map((r, i) => {
      const il = (r.impo_line as Record<string, unknown> | null) ?? {};
      const im = (il.impo as Record<string, unknown> | null) ?? {};
      const statusStyle = r.status === "approved"
        ? "background:#d1fae5;color:#065f46;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700"
        : "background:#fee2e2;color:#991b1b;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700";
      const qtyCell = r.status === "approved"
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

    const APP_URL = "https://techniline-ops-app.vercel.app";
    const statusEmoji = isApproved ? "&#9989;" : "&#10060;";
    const statusTitle = isApproved ? "Order Approved" : "Order Rejected";
    const statusSub = isApproved
      ? `Your order for <strong>${esc(customerRef)}</strong> has been fully approved.`
      : `Your order for <strong>${esc(customerRef)}</strong> was not approved.`;

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
  </div>
  <div style="background:#f8fafc;padding:24px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <a href="${APP_URL}/stock-reservation" style="display:inline-block;padding:13px 30px;background:#4f46e5;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">View My Reservations &rarr;</a>
  </div>
  <div style="background:#f1f5f9;padding:14px 36px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation System</p>
  </div>
</div>`;

    const totalLines = rows.length;
    const subject = isApproved
      ? `✅ Order Approved — ${customerRef} · ${totalLines} lines`
      : `❌ Order Rejected — ${customerRef} · ${totalLines} lines`;

    await sendStockEmail(requesterEmail, subject, html, {
      fromName: approverName,
      fromEmail: approverEmail ?? undefined,
      replyTo: approverEmail ? { address: approverEmail, name: approverName } : undefined,
    });
  } catch (e) {
    console.error("[group-email-action] salesperson notification failed:", e);
  }
}
