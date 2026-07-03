import type { SupabaseClient } from "@supabase/supabase-js";
import { getGraphToken } from "@/lib/amazon-ingest/graph";

export const GRACE_UID = "8d93ded3-ac73-4456-9d76-d48a6d2736f7";
const SENDER = process.env.PRIORITY_MAIL_FROM ?? "vihan@techniline.org";
const APP_URL = "https://techniline-ops-app.vercel.app";

export interface ReservationEmailData {
  id: string;
  requesterName: string;
  brand: string | null;
  itemCode: string;
  description: string | null;
  qtyRequested: number;
  qtyApproved?: number | null;
  customerRef: string | null;
  customerPhone: string | null;
  amountPaid: number | null;
  paymentMethod: string | null;
  requiredByDate: string | null;
  quoteRef: string | null;
  notes: string | null;
  discountOffered?: number | null;
  graceNotes?: string | null;
  impoNumber: string;
  impoEta: string | null;
  createdAt: string;
}

function esc(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function trow(label: string, value: string, alt: boolean): string {
  const bg = alt ? "background:#f8fafc;" : "background:#fff;";
  return `<tr style="${bg}">
    <td style="padding:10px 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#64748b;width:38%;border-bottom:1px solid #eef2f7;white-space:nowrap">${label}</td>
    <td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #eef2f7">${value}</td>
  </tr>`;
}

export function buildGraceNotificationHtml(
  data: ReservationEmailData,
  approveUrl: string,
  rejectUrl: string
): string {
  const paymentStr =
    data.amountPaid || data.paymentMethod
      ? [
          data.amountPaid ? `AED&nbsp;${data.amountPaid.toLocaleString("en")}` : null,
          data.paymentMethod ? esc(data.paymentMethod) : null,
        ]
          .filter(Boolean)
          .join(" &middot; ")
      : "—";

  const fields: [string, string][] = [
    ["Brand", esc(data.brand)],
    [
      "SKU / Item Code",
      `<span style="font-family:'Courier New',monospace;background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;letter-spacing:.03em">${esc(data.itemCode)}</span>`,
    ],
    ["Description", esc(data.description)],
    ["Qty Requested", `<strong style="color:#4f46e5;font-size:14px">${data.qtyRequested}&nbsp;units</strong>`],
    ["IMPO Number", esc(data.impoNumber)],
    ["ETA", fmtDate(data.impoEta)],
    ["Customer Name", esc(data.customerRef)],
    ["Customer Phone", esc(data.customerPhone)],
    ["Payment", paymentStr],
    ["Required By", fmtDate(data.requiredByDate)],
    ["Quote Ref", esc(data.quoteRef)],
  ];
  if (data.notes) fields.push(["Notes", `<em style="color:#475569">${esc(data.notes)}</em>`]);
  if (data.discountOffered && data.discountOffered > 0)
    fields.push(["Discount Given", `<strong style="color:#059669">${data.discountOffered}%</strong>`]);

  const tableRows = fields.map(([l, v], i) => trow(l, v, i % 2 === 0)).join("\n");
  const ts = fmtDate(data.createdAt);

  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#1e293b;background:#f8fafc">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:30px 36px;border-radius:16px 16px 0 0">
    <table style="border-collapse:collapse;width:100%"><tr>
      <td style="width:56px;vertical-align:middle">
        <div style="background:rgba(255,255,255,.18);border-radius:12px;width:46px;height:46px;text-align:center;line-height:46px;font-size:22px">&#128230;</div>
      </td>
      <td style="padding-left:14px;vertical-align:middle">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-.3px;line-height:1.2">New Reservation Request</h1>
        <p style="margin:5px 0 0;color:rgba(255,255,255,.72);font-size:13px">Submitted by <strong style="color:rgba(255,255,255,.95)">${esc(data.requesterName)}</strong> &middot; ${ts}</p>
      </td>
    </tr></table>
  </div>

  <!-- Summary bar -->
  <table style="width:100%;border-collapse:collapse;background:#fff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <tr>
      <td style="padding:16px 0;text-align:center;border-bottom:3px solid #4f46e5;width:33%;border-right:1px solid #e2e8f0">
        <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Salesperson</p>
        <p style="margin:5px 0 0;font-size:14px;font-weight:700;color:#1e293b">${esc(data.requesterName)}</p>
      </td>
      <td style="padding:16px 0;text-align:center;border-bottom:3px solid #4f46e5;width:33%;border-right:1px solid #e2e8f0">
        <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">Qty Requested</p>
        <p style="margin:5px 0 0;font-size:22px;font-weight:800;color:#4f46e5;line-height:1">${data.qtyRequested}<span style="font-size:12px;font-weight:600;color:#6366f1">&nbsp;units</span></p>
      </td>
      <td style="padding:16px 0;text-align:center;border-bottom:3px solid #4f46e5;width:33%">
        <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8">IMPO</p>
        <p style="margin:5px 0 0;font-size:14px;font-weight:700;color:#1e293b">${esc(data.impoNumber)}</p>
      </td>
    </tr>
  </table>

  <!-- Details -->
  <div style="background:#fff;padding:26px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8">Reservation Details</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <!-- Action buttons -->
  <div style="background:#f8fafc;padding:28px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#1e293b">Take Action</p>
    <p style="margin:0 0 22px;font-size:13px;color:#64748b;line-height:1.5">Review the details above and approve or reject directly from this email &mdash; no login required.</p>
    <table style="border-collapse:collapse;margin:0 auto"><tr>
      <td style="padding-right:8px">
        <a href="${approveUrl}" style="display:inline-block;padding:14px 34px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:.01em">&#10003;&nbsp;&nbsp;Approve</a>
      </td>
      <td style="padding-left:8px">
        <a href="${rejectUrl}" style="display:inline-block;padding:14px 34px;background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:.01em">&#10007;&nbsp;&nbsp;Reject</a>
      </td>
    </tr></table>
    <p style="margin:18px 0 0;font-size:11px;color:#94a3b8">Buttons expire in 72 hours &middot; <a href="${APP_URL}/stock-reservation/manager" style="color:#6366f1;text-decoration:none">Open Manager Dashboard</a></p>
  </div>

  <!-- Footer -->
  <div style="background:#f1f5f9;padding:14px 36px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation System &middot; ${ts}</p>
  </div>
</div>`;
}

export function buildSalespersonDecisionHtml(
  data: ReservationEmailData,
  outcome: "approved" | "rejected"
): string {
  const isApproved = outcome === "approved";
  const headerGrad = isApproved
    ? "linear-gradient(135deg,#059669 0%,#10b981 100%)"
    : "linear-gradient(135deg,#be123c 0%,#f43f5e 100%)";
  const statusEmoji = isApproved ? "&#9989;" : "&#10060;";
  const statusTitle = isApproved ? "Reservation Approved" : "Reservation Rejected";
  const effectiveQty = isApproved ? (data.qtyApproved ?? data.qtyRequested) : data.qtyRequested;
  const statusBody = isApproved
    ? `Your request for <strong>${effectiveQty}&nbsp;unit${effectiveQty !== 1 ? "s" : ""}</strong> of <strong>${esc(data.itemCode)}</strong> has been approved.`
    : `Your request for <strong>${data.qtyRequested}&nbsp;unit${data.qtyRequested !== 1 ? "s" : ""}</strong> of <strong>${esc(data.itemCode)}</strong> was not approved this time.`;

  const fields: [string, string][] = [
    ["Brand", esc(data.brand)],
    [
      "SKU / Item Code",
      `<span style="font-family:'Courier New',monospace;background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;letter-spacing:.03em">${esc(data.itemCode)}</span>`,
    ],
    ["Description", esc(data.description)],
    ["Qty Requested", `${data.qtyRequested}&nbsp;units`],
  ];

  if (isApproved) {
    const approvedStr =
      data.qtyApproved !== null &&
      data.qtyApproved !== undefined &&
      data.qtyApproved !== data.qtyRequested
        ? `<strong style="color:#059669">${data.qtyApproved}&nbsp;units</strong> <span style="color:#94a3b8;font-size:12px">(adjusted from ${data.qtyRequested})</span>`
        : `<strong style="color:#059669">${effectiveQty}&nbsp;units</strong>`;
    fields.push(["Qty Approved", approvedStr]);
  }

  fields.push(
    ["IMPO / ETA", `${esc(data.impoNumber)} &middot; ETA&nbsp;${fmtDate(data.impoEta)}`],
    [
      "Customer",
      data.customerRef
        ? esc(data.customerRef) + (data.customerPhone ? ` &middot; ${esc(data.customerPhone)}` : "")
        : "—",
    ]
  );

  if (data.graceNotes) {
    fields.push(["Reviewer's Notes", `<em style="color:#475569">${esc(data.graceNotes)}</em>`]);
  }
  if (data.discountOffered && data.discountOffered > 0)
    fields.push(["Discount Given", `<strong style="color:#059669">${data.discountOffered}%</strong>`]);

  const tableRows = fields.map(([l, v], i) => trow(l, v, i % 2 === 0)).join("\n");
  const ts = fmtDate(data.createdAt);

  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#1e293b;background:#f8fafc">

  <!-- Header -->
  <div style="background:${headerGrad};padding:40px 36px;border-radius:16px 16px 0 0;text-align:center">
    <div style="font-size:46px;line-height:1;margin-bottom:14px">${statusEmoji}</div>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-.4px">${statusTitle}</h1>
    <p style="margin:10px auto 0;color:rgba(255,255,255,.82);font-size:13px;max-width:380px;line-height:1.5">${statusBody}</p>
  </div>

  <!-- Details -->
  <div style="background:#fff;padding:28px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8">Reservation Details</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <!-- CTA -->
  <div style="background:#f8fafc;padding:24px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <a href="${APP_URL}/stock-reservation" style="display:inline-block;padding:13px 30px;background:#4f46e5;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">View My Reservations &rarr;</a>
  </div>

  <!-- Footer -->
  <div style="background:#f1f5f9;padding:14px 36px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation System &middot; ${ts}</p>
  </div>
</div>`;
}

export function buildStockArrivedHtml(data: ReservationEmailData): string {
  const effectiveQty = data.qtyApproved ?? data.qtyRequested;
  const fields: [string, string][] = [
    ["SKU / Item Code", `<span style="font-family:'Courier New',monospace;background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;letter-spacing:.03em">${esc(data.itemCode)}</span>`],
    ["Brand", esc(data.brand)],
    ["Description", esc(data.description)],
    ["Qty Reserved for You", `<strong style="color:#059669;font-size:14px">${effectiveQty}&nbsp;unit${effectiveQty !== 1 ? "s" : ""}</strong>`],
    ["IMPO Number", esc(data.impoNumber)],
    ["Customer", data.customerRef ? esc(data.customerRef) + (data.customerPhone ? ` &middot; ${esc(data.customerPhone)}` : "") : "—"],
  ];
  if (data.quoteRef) fields.push(["Quote / SO Ref", esc(data.quoteRef)]);
  if (data.graceNotes) fields.push(["Manager Note", `<em style="color:#475569">${esc(data.graceNotes)}</em>`]);
  const tableRows = fields.map(([l, v], i) => trow(l, v, i % 2 === 0)).join("\n");

  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#1e293b;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);padding:40px 36px;border-radius:16px 16px 0 0;text-align:center">
    <div style="font-size:52px;line-height:1;margin-bottom:14px">&#128230;</div>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-.4px">Your Stock Has Arrived!</h1>
    <p style="margin:10px auto 0;color:rgba(255,255,255,.82);font-size:13px;max-width:400px;line-height:1.5">
      Your reservation for <strong>${esc(data.itemCode)}</strong> &times; ${effectiveQty} unit${effectiveQty !== 1 ? "s" : ""} has landed. Please coordinate collection with the manager.
    </p>
  </div>
  <div style="background:#fff;padding:28px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8">Your Reservation</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <tbody>${tableRows}</tbody>
    </table>
  </div>
  <div style="background:#f8fafc;padding:24px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 16px;font-size:14px;color:#374151;font-weight:600">Ready to collect? Contact your manager to arrange pickup.</p>
    <a href="${APP_URL}/stock-reservation" style="display:inline-block;padding:13px 30px;background:#059669;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">View My Reservations &rarr;</a>
  </div>
  <div style="background:#f1f5f9;padding:14px 36px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation System</p>
  </div>
</div>`;
}

export function buildFulfillmentHtml(data: ReservationEmailData): string {
  const effectiveQty = data.qtyApproved ?? data.qtyRequested;
  const fields: [string, string][] = [
    ["SKU / Item Code", `<span style="font-family:'Courier New',monospace;background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;letter-spacing:.03em">${esc(data.itemCode)}</span>`],
    ["Brand", esc(data.brand)],
    ["Description", esc(data.description)],
    ["Qty Collected", `<strong style="color:#0891b2;font-size:14px">${effectiveQty}&nbsp;unit${effectiveQty !== 1 ? "s" : ""}</strong>`],
    ["IMPO Number", esc(data.impoNumber)],
    ["Customer", data.customerRef ? esc(data.customerRef) + (data.customerPhone ? ` &middot; ${esc(data.customerPhone)}` : "") : "—"],
  ];
  if (data.quoteRef) fields.push(["Quote / SO Ref", esc(data.quoteRef)]);
  if (data.graceNotes) fields.push(["Manager Note", `<em style="color:#475569">${esc(data.graceNotes)}</em>`]);
  const tableRows = fields.map(([l, v], i) => trow(l, v, i % 2 === 0)).join("\n");

  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#1e293b;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#0891b2 0%,#06b6d4 100%);padding:40px 36px;border-radius:16px 16px 0 0;text-align:center">
    <div style="font-size:52px;line-height:1;margin-bottom:14px">&#127873;</div>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-.4px">Stock Collected!</h1>
    <p style="margin:10px auto 0;color:rgba(255,255,255,.82);font-size:13px;max-width:400px;line-height:1.5">
      Your reservation for <strong>${esc(data.itemCode)}</strong> &times; ${effectiveQty} unit${effectiveQty !== 1 ? "s" : ""} has been handed over. This is your collection confirmation.
    </p>
  </div>
  <div style="background:#fff;padding:28px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8">Collection Summary</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <tbody>${tableRows}</tbody>
    </table>
  </div>
  <div style="background:#f8fafc;padding:24px 36px;text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
    <p style="margin:0 0 16px;font-size:13px;color:#374151">Keep this email as your record of collection. For any discrepancies, contact your manager.</p>
    <a href="${APP_URL}/stock-reservation" style="display:inline-block;padding:13px 30px;background:#0891b2;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px">View My Reservations &rarr;</a>
  </div>
  <div style="background:#f1f5f9;padding:14px 36px;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">Techniline Ops &middot; Stock Reservation System</p>
  </div>
</div>`;
}

export async function sendStockEmail(
  to: string,
  subject: string,
  html: string,
  opts?: {
    replyTo?: { address: string; name?: string };
    fromName?: string;
    /** Send from this mailbox instead of the system default. Must be a @techniline.org account
     *  that the Graph app has Mail.Send permission on. */
    fromEmail?: string;
    cc?: string;
    bcc?: string;
  }
): Promise<void> {
  const graphToken = await getGraphToken();
  const senderMailbox = opts?.fromEmail ?? SENDER;
  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: [{ emailAddress: { address: to } }],
    from: { emailAddress: { address: senderMailbox, name: opts?.fromName ?? "Techniline Ops" } },
  };
  if (opts?.replyTo) {
    message.replyTo = [{ emailAddress: { address: opts.replyTo.address, name: opts.replyTo.name ?? opts.replyTo.address } }];
  }
  if (opts?.cc) {
    message.ccRecipients = opts.cc
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => ({ emailAddress: { address: a } }));
  }
  if (opts?.bcc) {
    message.bccRecipients = opts.bcc
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => ({ emailAddress: { address: a } }));
  }
  let res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderMailbox)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${graphToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    }
  );

  // If the user mailbox is blocked by an Exchange ApplicationAccessPolicy (403) or doesn't
  // exist (404), fall back to the system sender so the email still reaches the recipient.
  if (!res.ok && opts?.fromEmail && (res.status === 403 || res.status === 404)) {
    console.warn(
      `[sendStockEmail] mailbox ${opts.fromEmail} returned ${res.status} — ` +
        "falling back to system sender. Fix the Exchange ApplicationAccessPolicy to resolve this."
    );
    const fallbackMessage = { ...message, from: { emailAddress: { address: SENDER, name: opts?.fromName ?? "Techniline Ops" } } };
    res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER)}/sendMail`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${graphToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: fallbackMessage, saveToSentItems: true }),
      }
    );
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph sendMail ${res.status}: ${t.slice(0, 300)}`);
  }
}

export async function getUserEmailById(svc: SupabaseClient, uid: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (svc.auth as any).admin.getUserById(uid);
    return (data?.user?.email as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Returns uid + email + display name for every user with stock_reservation_manager capability. */
export async function getManagerProfiles(
  svc: SupabaseClient
): Promise<{ uid: string; email: string; name: string }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (svc as any)
    .from("users")
    .select("id, full_name")
    .contains("portal_access", ["stock_reservation_manager"]);

  if (!data?.length) return [];

  const profiles = await Promise.all(
    (data as { id: string; full_name: string | null }[]).map(async (row) => {
      const email = await getUserEmailById(svc, row.id);
      if (!email) return null;
      return { uid: row.id, email, name: row.full_name ?? email };
    })
  );

  return profiles.filter((p): p is { uid: string; email: string; name: string } => p !== null);
}

/** Create one approve + one reject token for a specific manager (reviewer_uid stored on token). */
export async function createApproveRejectTokens(
  svc: SupabaseClient,
  reservationId: string,
  reviewerUid?: string
): Promise<{ approveToken: string; rejectToken: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc as any)
    .from("stock_reservation_email_tokens")
    .insert([
      { reservation_id: reservationId, action: "approve", reviewer_uid: reviewerUid ?? null },
      { reservation_id: reservationId, action: "reject", reviewer_uid: reviewerUid ?? null },
    ])
    .select("id, action");

  if (error) throw new Error(error.message);

  const rows = data as { id: string; action: string }[];
  const approveRow = rows.find((r) => r.action === "approve");
  const rejectRow = rows.find((r) => r.action === "reject");
  if (!approveRow || !rejectRow) throw new Error("Failed to create email tokens.");

  return { approveToken: approveRow.id, rejectToken: rejectRow.id };
}
