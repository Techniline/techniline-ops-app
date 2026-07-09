import { authorizeStockReservation } from "@/lib/stock-reservation/serverAuth";
import {
  getManagerProfiles,
  sendStockEmail,
  createApproveRejectTokens,
} from "@/lib/stock-reservation/emailService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GroupLine {
  impo_line_id: string;
  qty_requested: number;
  discount_offered?: number;
}

interface GroupBody {
  customer_ref: string;
  customer_phone?: string;
  amount_paid?: number;
  payment_method?: string;
  required_by_date?: string;
  quote_ref?: string;
  notes?: string;
  lines: GroupLine[];
}

const APP_URL = "https://techniline-ops-app.vercel.app";

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeStockReservation(request);
  if (!auth) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = auth.serviceClient as any;

  let body: GroupBody;
  try {
    body = await request.json() as GroupBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { customer_ref, customer_phone, amount_paid, payment_method, required_by_date, quote_ref, notes, lines } = body;
  if (!customer_ref?.trim()) return Response.json({ ok: false, error: "customer_ref required." }, { status: 400 });
  if (!lines?.length) return Response.json({ ok: false, error: "At least one line required." }, { status: 400 });
  if (lines.length > 30) return Response.json({ ok: false, error: "Maximum 30 lines per order." }, { status: 400 });

  // Create the reservation group
  const { data: groupRow, error: grpErr } = await svc
    .from("reservation_groups")
    .insert({
      requested_by: auth.uid,
      customer_ref: customer_ref.trim(),
      customer_phone: customer_phone?.trim() || null,
      amount_paid: typeof amount_paid === "number" ? amount_paid : 0,
      payment_method: payment_method || null,
      required_by_date: required_by_date || null,
      quote_ref: quote_ref?.trim() || null,
      notes: notes?.trim() || null,
    })
    .select("id")
    .single();

  if (grpErr || !groupRow) {
    return Response.json({ ok: false, error: grpErr?.message ?? "Failed to create group." }, { status: 500 });
  }

  const groupId = (groupRow as { id: string }).id;
  const reservationIds: string[] = [];
  const failedLines: { index: number; error: string }[] = [];

  // Pre-check: fetch IMPO statuses for all requested lines in one query
  const { data: lineImpoRows } = await svc
    .from("impo_lines")
    .select("id, impo:impos(status)")
    .in("id", lines.map((l) => l.impo_line_id));

  const arrivedLineIds = new Set(
    ((lineImpoRows ?? []) as { id: string; impo: { status: string } | null }[])
      .filter((l) => l.impo?.status === "arrived")
      .map((l) => l.id)
  );

  // Create each reservation line atomically
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (arrivedLineIds.has(line.impo_line_id)) {
      failedLines.push({ index: i, error: "This IMPO has been received. Bookings are closed." });
      continue;
    }

    const { data: resId, error: rpcErr } = await svc.rpc("create_reservation", {
      p_impo_line_id:    line.impo_line_id,
      p_requested_by:    auth.uid,
      p_qty_requested:   line.qty_requested,
      p_customer_ref:    customer_ref.trim(),
      p_customer_phone:  customer_phone?.trim() ?? null,
      p_amount_paid:     typeof amount_paid === "number" ? amount_paid : 0,
      p_payment_method:  payment_method ?? null,
      p_required_by_date: required_by_date ?? null,
      p_quote_ref:       quote_ref?.trim() ?? null,
      p_notes:           notes?.trim() ?? null,
      p_discount_offered: typeof line.discount_offered === "number" ? line.discount_offered : 0,
      p_group_id:        groupId,
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      if (msg.includes("INSUFFICIENT_STOCK:")) {
        const available = parseInt(msg.split(":")[1] ?? "0", 10);
        failedLines.push({ index: i, error: `Only ${available} unit(s) available.` });
      } else {
        failedLines.push({ index: i, error: msg });
      }
    } else {
      reservationIds.push(resId as string);
    }
  }

  // If ALL lines failed, delete the group and return error
  if (reservationIds.length === 0) {
    await svc.from("reservation_groups").delete().eq("id", groupId);
    return Response.json(
      { ok: false, error: "No lines could be reserved.", details: failedLines },
      { status: 409 }
    );
  }

  // If SOME lines failed, partial success is still ok — report which failed
  await (async () => {
    try {
      const [profileData, managers] = await Promise.all([
        svc.from("users").select("full_name").eq("id", auth.uid).maybeSingle(),
        getManagerProfiles(auth.serviceClient),
      ]);
      if (!managers.length) return;

      const requesterName = (profileData.data as { full_name?: string } | null)?.full_name ?? auth.email ?? "Salesperson";

      // Fetch line details for the email
      const { data: resRows } = await svc
        .from("stock_reservations")
        .select("*, impo_line:impo_lines(item_code, brand, description, impo:impos(impo_number, eta))")
        .eq("group_id", groupId);

      if (!resRows?.length) return;

      const lineRows = (resRows as Record<string, unknown>[]).map((r) => {
        const il = (r.impo_line as Record<string, unknown> | null) ?? {};
        const im = (il.impo as Record<string, unknown> | null) ?? {};
        return {
          itemCode: (il.item_code as string) ?? "—",
          brand: (il.brand as string | null) ?? null,
          qty: r.qty_requested as number,
          impoNumber: (im.impo_number as string) ?? "—",
          impoEta: (im.eta as string | null) ?? null,
          discount: r.discount_offered as number ?? 0,
        };
      });

      const fmtDate = (iso: string | null) => {
        if (!iso) return "—";
        try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; }
      };

      const lineTableRows = lineRows.map((l, i) =>
        `<tr style="${i % 2 === 0 ? "background:#f8fafc;" : "background:#fff;"}">
          <td style="padding:9px 14px;font-size:12px;font-family:'Courier New',monospace;border-bottom:1px solid #eef2f7">${l.itemCode}</td>
          <td style="padding:9px 14px;font-size:12px;color:#64748b;border-bottom:1px solid #eef2f7">${l.brand ?? "—"}</td>
          <td style="padding:9px 14px;font-size:12px;text-align:center;border-bottom:1px solid #eef2f7">${l.impoNumber}</td>
          <td style="padding:9px 14px;font-size:12px;text-align:center;border-bottom:1px solid #eef2f7">${fmtDate(l.impoEta)}</td>
          <td style="padding:9px 14px;font-size:12px;text-align:center;border-bottom:1px solid #eef2f7">${l.discount > 0 ? l.discount + "%" : "—"}</td>
          <td style="padding:9px 14px;font-size:13px;font-weight:700;color:#4f46e5;text-align:right;border-bottom:1px solid #eef2f7">${l.qty}</td>
        </tr>`
      ).join("");

      const totalQty = lineRows.reduce((s, l) => s + l.qty, 0);
      const paymentStr = amount_paid && amount_paid > 0
        ? `AED ${amount_paid.toLocaleString("en")}${payment_method ? ` · ${payment_method}` : ""}`
        : null;

      const bodyHtml = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:660px;margin:0 auto;color:#1e293b;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:30px 36px;border-radius:16px 16px 0 0">
    <table style="border-collapse:collapse;width:100%"><tr>
      <td style="width:56px;vertical-align:middle">
        <div style="background:rgba(255,255,255,.18);border-radius:12px;width:46px;height:46px;text-align:center;line-height:46px;font-size:22px">&#128230;</div>
      </td>
      <td style="padding-left:14px;vertical-align:middle">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-.3px">New Multi-SKU Order Request</h1>
        <p style="margin:5px 0 0;color:rgba(255,255,255,.72);font-size:13px">From <strong style="color:rgba(255,255,255,.95)">${requesterName}</strong> &middot; ${lineRows.length} line${lineRows.length !== 1 ? "s" : ""} &middot; ${totalQty} units total</p>
      </td>
    </tr></table>
  </div>
  <table style="width:100%;border-collapse:collapse;background:#fff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <tr>
      <td style="padding:16px 0;text-align:center;border-bottom:3px solid #4f46e5;width:33%;border-right:1px solid #e2e8f0">
        <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Salesperson</p>
        <p style="margin:5px 0 0;font-size:14px;font-weight:700;color:#1e293b">${requesterName}</p>
      </td>
      <td style="padding:16px 0;text-align:center;border-bottom:3px solid #4f46e5;width:33%;border-right:1px solid #e2e8f0">
        <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Customer</p>
        <p style="margin:5px 0 0;font-size:14px;font-weight:700;color:#1e293b">${customer_ref}</p>
      </td>
      <td style="padding:16px 0;text-align:center;border-bottom:3px solid #4f46e5;width:33%">
        <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Total Units</p>
        <p style="margin:5px 0 0;font-size:22px;font-weight:800;color:#4f46e5;line-height:1">${totalQty}</p>
      </td>
    </tr>
  </table>
  ${paymentStr ? `<div style="background:#fff;padding:10px 36px 0;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#059669;font-weight:600">&#10003;&nbsp; Payment: ${paymentStr}</p></div>` : ""}
  ${required_by_date ? `<div style="background:#fff;padding:8px 36px 0;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#64748b">Required by: <strong>${fmtDate(required_by_date)}</strong></p></div>` : ""}
  ${quote_ref ? `<div style="background:#fff;padding:8px 36px 0;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0"><p style="margin:0;font-size:12px;color:#64748b">Quote / SO Ref: <strong>${quote_ref}</strong></p></div>` : ""}
  <div style="background:#fff;padding:24px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8">Line Items</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left">SKU</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left">Brand</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:center">IMPO</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:center">ETA</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:center">Disc%</th>
        <th style="padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:right">Qty</th>
      </tr></thead>
      <tbody>${lineTableRows}</tbody>
    </table>
    ${notes ? `<p style="margin:14px 0 0;font-size:12px;color:#64748b;font-style:italic">Notes: ${notes}</p>` : ""}
  </div>
  __ACTION_SECTION__
  <div style="background:#f1f5f9;padding:14px 36px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation System</p>
  </div>
</div>`;

      const subject = `📦 New Order Request — ${customer_ref} · ${lineRows.length} SKUs · ${totalQty} units from ${requesterName}`;

      // Send each manager their own email with unique action tokens tied to their UID
      for (const mgr of managers) {
        try {
          const mgrTokens = await createApproveRejectTokens(auth.serviceClient, reservationIds[0], mgr.uid).catch(() => null);
          const actionSection = mgrTokens
            ? `<div style="background:#f8fafc;padding:24px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 16px;font-size:14px;color:#64748b">Approve or reject all lines at once, or review individually in the dashboard.</p>
    <table style="border-collapse:collapse;margin:0 auto 16px"><tr>
      <td style="padding:0 8px"><a href="${APP_URL}/api/stock-reservation/group-email-action?token=${mgrTokens.approveToken}" style="display:inline-block;padding:13px 26px;background:#059669;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">&#9989; Approve All</a></td>
      <td style="padding:0 8px"><a href="${APP_URL}/api/stock-reservation/group-email-action?token=${mgrTokens.rejectToken}" style="display:inline-block;padding:13px 26px;background:#dc2626;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">&#10060; Reject All</a></td>
    </tr></table>
    <a href="${APP_URL}/stock-reservation/manager" style="font-size:13px;color:#6366f1;text-decoration:none">Review individually in Dashboard &rarr;</a>
  </div>`
            : `<div style="background:#f8fafc;padding:24px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <a href="${APP_URL}/stock-reservation/manager" style="display:inline-block;padding:13px 30px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">Review Order in Dashboard &rarr;</a>
  </div>`;

          const html = bodyHtml.replace("__ACTION_SECTION__", actionSection);
          await sendStockEmail(mgr.email, subject, html, {
            fromName: `${requesterName} (via Techniline Ops)`,
            replyTo: auth.email ? { address: auth.email, name: requesterName } : undefined,
          });
        } catch (err) {
          console.error(`[group] notification to ${mgr.email} failed:`, err);
        }
      }
    } catch (e) {
      console.error("[group] Grace notification failed:", e);
    }
  })();

  return Response.json({
    ok: true,
    group_id: groupId,
    reservation_ids: reservationIds,
    ...(failedLines.length > 0 ? { partial: true, failed: failedLines } : {}),
  });
}
