import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

import { findOutcome } from "./mapping";

/** One dispute row parsed from the Amazon "Disputes" export (xlsx/csv). */
export interface DisputeReportRow {
  disputeNumber: string;
  marketplace: string | null;
  disputeType: string | null;
  reason: string | null;
  title: string | null;
  returnIds: string[];        // extracted from the Title column
  disputeDate: string | null; // YYYY-MM-DD
  status: string; // raw Amazon status text ("Resolved", "Rejected", …)
  totalDisputedAed: number | null;
  approvedAed: number | null;
}

export interface ImportSummary {
  parsed: number;
  disputesCreated: number;
  disputesUpdated: number;
  disputesUnchanged: number;
  actionsClosed: number;
  errors: string[];
}

/* ----------------------------- parsing (pure) ----------------------------- */

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/** "AED 2,091.85" / "2091.85" / 2091.85 → 2091.85 (null when absent). */
function parseAed(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A Date / Excel-serial / "2026-07-17 00:00:00" → "2026-07-17" (null when absent). */
function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime())
    ? null
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Parse the sheet (array-of-arrays, header:1) into dispute rows. Column order is
 * resolved by header name, so a re-ordered export still works. Rows without a
 * DSPT id are skipped.
 */
export function parseDisputeReportSheet(rows: unknown[][]): DisputeReportRow[] {
  if (!rows || rows.length < 2) return [];

  // Find the header row (the one that mentions "dispute id").
  let headerIdx = rows.findIndex((r) => r.some((c) => norm(c) === "dispute id"));
  if (headerIdx < 0) headerIdx = 0;
  const header = rows[headerIdx].map(norm);

  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cId = col("dispute id");
  const cMarket = col("marketplace");
  const cType = col("dispute type");
  const cReason = col("dispute reason");
  const cTitle = col("title");
  const cDate = col("dispute date");
  const cStatus = col("dispute status", "status");
  const cTotal = col("total disputed amount", "total disputed");
  const cApproved = col("approved amount", "approved");

  const out: DisputeReportRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const idRaw = cId >= 0 ? String(r[cId] ?? "").trim() : "";
    const dispute = idRaw.match(/DSPT\d+/i)?.[0];
    if (!dispute) continue;
    const titleRaw = cTitle >= 0 ? String(r[cTitle] ?? "").trim() : "";
    // Extract return IDs from title: "Dispute against vendor returns – return IDs - 10011153788016"
    // Also handles multiple IDs if ever comma-separated.
    const returnIds: string[] = [];
    const idMatches = titleRaw.matchAll(/\b(\d{12,20})\b/g);
    for (const m of idMatches) returnIds.push(m[1]);
    out.push({
      disputeNumber: dispute.toUpperCase(),
      marketplace: cMarket >= 0 ? (String(r[cMarket] ?? "").trim() || null) : null,
      disputeType: cType >= 0 ? (String(r[cType] ?? "").trim() || null) : null,
      reason: cReason >= 0 ? (String(r[cReason] ?? "").trim() || null) : null,
      title: titleRaw || null,
      returnIds,
      disputeDate: cDate >= 0 ? parseDate(r[cDate]) : null,
      status: cStatus >= 0 ? String(r[cStatus] ?? "").trim() : "",
      totalDisputedAed: cTotal >= 0 ? parseAed(r[cTotal]) : null,
      approvedAed: cApproved >= 0 ? parseAed(r[cApproved]) : null,
    });
  }
  return out;
}

/* --------------------------- reconcile (server) --------------------------- */

interface MappedStatus {
  disputeStatus: string;
  resolved: boolean;
  /** amazon_action_log outcome to close the Amazon Action with (null = leave open). */
  outcome: string | null;
}

/** Map the report's status text (+ approved amount) to our dispute/action state. */
function mapStatus(statusRaw: string, approved: number | null): MappedStatus {
  const s = statusRaw.toLowerCase();
  if (/reject|denied|declin/.test(s)) {
    return { disputeStatus: "amazon_rejected", resolved: true, outcome: "amazon_rejected" };
  }
  if (/re-?open/.test(s)) {
    return { disputeStatus: "open", resolved: false, outcome: null };
  }
  if (/resolv|approv|credit|paid|complete/.test(s)) {
    // Resolved WITH a credit → approved; resolved with AED 0 → Amazon gave nothing
    // back (claim not credited) → rejected. "amazon_rejected" is an allowed
    // dispute_status; the exact reason/amount is preserved in the note + comment.
    return approved != null && approved > 0
      ? { disputeStatus: "amazon_approved", resolved: true, outcome: "credit_received" }
      : { disputeStatus: "amazon_rejected", resolved: true, outcome: "amazon_rejected" };
  }
  // pending / under review / action required / draft / open → still awaiting Amazon
  return { disputeStatus: "awaiting_amazon", resolved: false, outcome: null };
}

type Db = SupabaseClient<Database>;

/**
 * Reconcile a parsed Amazon dispute report against our data (service-role client
 * — bypasses RLS). For each row: update/create the `disputes` record (status +
 * approved amount are authoritative; other fields only fill blanks) and, when the
 * dispute has a linked Amazon Action, close it with the matching logged outcome.
 * Idempotent: re-running makes no further changes.
 */
export async function reconcileDisputeReport(
  db: Db,
  rows: DisputeReportRow[],
  createdBy: string
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    parsed: rows.length,
    disputesCreated: 0,
    disputesUpdated: 0,
    disputesUnchanged: 0,
    actionsClosed: 0,
    errors: [],
  };
  if (rows.length === 0) return summary;

  const numbers = [...new Set(rows.map((r) => r.disputeNumber))];

  // Existing disputes keyed by dispute_number.
  const { data: existingDisputes } = await db
    .from("disputes")
    .select("id, dispute_number, dispute_status, approved_amount_aed, invoice_amount_aed, invoice_date, dispute_type, resolved_at, resolution_comment, return_ids")
    .in("dispute_number", numbers);
  const disputeByNumber = new Map<string, NonNullable<typeof existingDisputes>[number]>();
  for (const d of existingDisputes ?? []) if (d.dispute_number) disputeByNumber.set(d.dispute_number, d);

  // Linked Amazon Actions (dispute follow-ups) keyed by ref_number, + latest outcome.
  const { data: actions } = await db
    .from("expected_actions")
    .select("id, ref_number, status")
    .eq("type", "dispute_update")
    .in("ref_number", numbers);
  const actionByNumber = new Map<string, NonNullable<typeof actions>[number]>();
  for (const a of actions ?? []) if (a.ref_number) actionByNumber.set(a.ref_number, a);

  const eaIds = (actions ?? []).map((a) => a.id);
  const latestOutcomeByEa = new Map<string, string>();
  if (eaIds.length > 0) {
    const { data: logs } = await db
      .from("amazon_action_log")
      .select("expected_action_id, outcome, created_at")
      .in("expected_action_id", eaIds)
      .order("created_at", { ascending: true });
    for (const l of logs ?? []) latestOutcomeByEa.set(l.expected_action_id, l.outcome); // last wins (ascending)
  }

  const nowIso = new Date().toISOString();

  for (const row of rows) {
    try {
      const m = mapStatus(row.status, row.approvedAed);
      const existing = disputeByNumber.get(row.disputeNumber);

      // 1) disputes: authoritative status + approved amount; fill blanks otherwise.
      if (existing) {
        const patch: Database["public"]["Tables"]["disputes"]["Update"] = {
          dispute_status: m.disputeStatus,
          approved_amount_aed: row.approvedAed ?? existing.approved_amount_aed,
        };
        if (m.resolved && !existing.resolved_at) patch.resolved_at = nowIso;
        if ((existing.invoice_amount_aed ?? 0) === 0 && row.totalDisputedAed != null) patch.invoice_amount_aed = row.totalDisputedAed;
        if (!existing.invoice_date && row.disputeDate) patch.invoice_date = row.disputeDate;
        if (!existing.dispute_type && row.disputeType) patch.dispute_type = row.disputeType;
        if (!existing.resolution_comment) {
          patch.resolution_comment = `Imported from Amazon dispute report (${row.status}${row.approvedAed != null ? `, approved AED ${row.approvedAed}` : ""}).`;
        }

        const changed =
          existing.dispute_status !== patch.dispute_status ||
          (existing.approved_amount_aed ?? null) !== (patch.approved_amount_aed ?? null) ||
          patch.resolved_at !== undefined ||
          patch.invoice_amount_aed !== undefined ||
          patch.invoice_date !== undefined ||
          patch.dispute_type !== undefined ||
          patch.resolution_comment !== undefined;

        if (changed) {
          if (row.returnIds.length > 0 && !existing.return_ids) {
            patch.return_ids = row.returnIds.join(", ");
          }
          const { error } = await db.from("disputes").update(patch).eq("id", existing.id);
          if (error) throw new Error(`update ${row.disputeNumber}: ${error.message}`);
          summary.disputesUpdated++;
        } else {
          summary.disputesUnchanged++;
        }
      } else {
        const { error } = await db.from("disputes").insert({
          dispute_number: row.disputeNumber,
          dispute_status: m.disputeStatus,
          invoice_amount_aed: row.totalDisputedAed ?? 0, // NOT NULL
          approved_amount_aed: row.approvedAed ?? null,
          invoice_date: row.disputeDate,
          dispute_type: row.disputeType,
          return_ids: row.returnIds.length > 0 ? row.returnIds.join(", ") : null,
          resolved_at: m.resolved ? nowIso : null,
          resolution_comment: `Imported from Amazon dispute report (${row.status}${row.approvedAed != null ? `, approved AED ${row.approvedAed}` : ""}).`,
        });
        if (error) throw new Error(`insert ${row.disputeNumber}: ${error.message}`);
        summary.disputesCreated++;
      }

      // Upsert dispute_items for each linked return ID
      if (row.returnIds.length > 0) {
        const { data: existingItems } = await db
          .from("dispute_items")
          .select("return_id")
          .eq("dispute_number", row.disputeNumber)
          .in("return_id", row.returnIds);
        const existingReturnIds = new Set((existingItems ?? []).map((i) => i.return_id));
        for (const rid of row.returnIds) {
          if (existingReturnIds.has(rid)) continue;
          await db.from("dispute_items").insert({
            dispute_number: row.disputeNumber,
            return_id: rid,
            line_amount_aed: row.returnIds.length === 1 ? row.totalDisputedAed : null,
            line_status: m.resolved ? "resolved" : "open",
            resolved_at: m.resolved ? nowIso : null,
          });
        }
      }

      // 2) Write recovery status back to linked returns.
      // This is the only place we can do it reliably — the dispute report is
      // the authoritative source for approved amounts and resolution.
      if (row.returnIds.length > 0 || true) {
        const returnStatus = m.disputeStatus === "amazon_approved" ? "recovered"
          : m.disputeStatus === "amazon_rejected" ? "rejected"
          : null;
        if (returnStatus) {
          // By numeric return ID (from dispute_items / title)
          if (row.returnIds.length > 0) {
            await db.from("returns").update({ status: returnStatus }).in("return_id", row.returnIds);
          }
          // By dispute_id_ref (manually entered DSPT link on the return)
          await db.from("returns").update({ status: returnStatus }).eq("dispute_id_ref", row.disputeNumber);
        }
      }

      // 3) Close the linked Amazon Action (if any) with the matching outcome.
      const action = actionByNumber.get(row.disputeNumber);
      if (action && m.outcome && latestOutcomeByEa.get(action.id) !== m.outcome) {
        const opt = findOutcome("dispute", m.outcome);
        const { error: logErr } = await db.from("amazon_action_log").insert({
          expected_action_id: action.id,
          action_type: "dispute",
          outcome: m.outcome,
          reference_type: null,
          reference_value: null,
          reason_note:
            m.outcome === "credit_received"
              ? null
              : `${row.reason ? `${row.reason} — ` : ""}Amazon dispute report: ${row.status}, AED ${row.approvedAed ?? 0} approved.`,
          workflow_status: opt?.workflowStatus ?? "resolved",
          amount_aed: row.totalDisputedAed ?? null,
          recovered_aed: m.outcome === "credit_received" ? row.approvedAed : null,
          approved_amount_aed: row.approvedAed ?? null,
          confidence: "high",
          created_by: createdBy,
          notes: `Auto-closed from Amazon dispute report import.`,
        });
        if (logErr) throw new Error(`log ${row.disputeNumber}: ${logErr.message}`);
        const { error: eaErr } = await db.from("expected_actions").update({ status: "actioned" }).eq("id", action.id);
        if (eaErr) throw new Error(`close ${row.disputeNumber}: ${eaErr.message}`);
        summary.actionsClosed++;
      }
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : `Failed on ${row.disputeNumber}`);
    }
  }

  return summary;
}
