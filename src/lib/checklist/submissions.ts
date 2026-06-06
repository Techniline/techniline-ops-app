import { supabase } from "@/lib/supabaseClient";
import type { TablesInsert } from "@/lib/types";

import { setDailyTaskStatus } from "./queries";

export type SubmissionInsert = TablesInsert<"submissions">;

/** The evidence portion of a submission, built by the UI per evidence_type. */
export interface TaskEvidence {
  evidenceText?: string | null;
  evidenceCount?: number | null;
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
