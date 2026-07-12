import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert } from "@/lib/types";

import { setDailyTaskStatus } from "./queries";

export type SubmissionInsert = TablesInsert<"submissions">;
export type Submission = Tables<"submissions">;

/**
 * Fetch submissions (the work log) for the given daily-task ids, newest first.
 * Fail-soft: returns [] on error (e.g. before a `submissions` read policy
 * exists) so the checklist page never breaks.
 */
export async function fetchSubmissionsForTasks(
  taskIds: string[]
): Promise<Submission[]> {
  if (taskIds.length === 0) return [];
  const { data, error } = await supabase
    .from("submissions")
    .select("*")
    .in("daily_task_id", taskIds)
    .order("submitted_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Private bucket holding checklist proof files (screenshots / PDFs). */
const EVIDENCE_BUCKET = "checklist-evidence";

/** Upload a proof file; returns the stored object path (or throws). */
export async function uploadEvidenceFile(file: File): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `evidence/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { upsert: false });
  if (error) throw new Error(`Proof upload failed: ${error.message}`);
  return path;
}

/** Short-lived signed URL to view a stored proof file (null on failure). */
export async function evidenceFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * After a `pairs` task is submitted, upsert each (amazon_order_id, invoice_number)
 * pair into seller_order_docs so every other module that reads that table gets the
 * invoice number automatically — no double entry needed.
 * Fails silently per-row so a bad order ID doesn't block the whole submission.
 */
export async function syncOrderInvoicePairs(evidenceText: string): Promise<void> {
  const pairs = evidenceText
    .split(",")
    .map((p) => { const [o, inv] = p.split(":"); return { order: o?.trim() ?? "", invoice: inv?.trim() ?? "" }; })
    .filter((p) => p.order && p.invoice);
  for (const { order, invoice } of pairs) {
    const { error } = await supabase
      .from("seller_order_docs")
      .upsert({ amazon_order_id: order, invoice_number: invoice }, { onConflict: "amazon_order_id" });
    if (error) console.error(`[syncInvoicePairs] ${order}:`, error.message);
  }
}

/** The evidence portion of a submission, built by the UI per evidence_type. */
export interface TaskEvidence {
  evidenceText?: string | null;
  evidenceCount?: number | null;
  evidenceFilePath?: string | null;
  isNothingToAction?: boolean;
  nothingToActionNote?: string | null;
}

export interface SubmitTaskArgs extends TaskEvidence {
  /** `daily_tasks.id` of the task being submitted. */
  taskId: string;
  /** The authenticated user's id (`profile.id`) → `submissions.submitted_by`. */
  submittedBy: string;
}

/**
 * Submit a checklist task with proof, mirroring v1's safe ordering:
 *
 * 1. Insert the `submissions` row FIRST (the evidence). If this fails, the task
 *    is left open — nothing is lost.
 * 2. Only then mark `daily_tasks.status = 'submitted'` via the existing guarded
 *    {@link setDailyTaskStatus}, which throws on a DB error OR a zero-row update
 *    (a silent RLS rejection — e.g. staff trying to submit another user's task).
 *
 * Throws on any failure; resolves on success.
 */
export async function submitTaskWithEvidence(args: SubmitTaskArgs): Promise<void> {
  const {
    taskId,
    submittedBy,
    evidenceText = null,
    evidenceCount = null,
    isNothingToAction = false,
    nothingToActionNote = null,
  } = args;

  // Note: evidence_file_path is intentionally NOT inserted — the file-attach
  // feature was reverted and that column may not exist on the table; including
  // it made every submission fail.
  const payload: SubmissionInsert = {
    daily_task_id: taskId,
    submitted_by: submittedBy,
    submitted_at: new Date().toISOString(),
    evidence_text: evidenceText,
    evidence_count: evidenceCount,
    is_nothing_to_action: isNothingToAction,
    nothing_to_action_note: nothingToActionNote,
  };

  // 1) Evidence first.
  const { error: insertError } = await supabase
    .from("submissions")
    .insert(payload);
  if (insertError) throw insertError;

  // 2) Then mark the task submitted (throws on error / zero rows updated).
  await setDailyTaskStatus({ id: taskId, status: "submitted" });
}
