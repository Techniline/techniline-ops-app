import { computeActionSummary, fetchAmazonActions } from "@/lib/amazon-actions";
import { calculateCocobluSummary, fetchCocobluAgeing } from "@/lib/cocoblu";
import { fetchChecklistForDate } from "@/lib/checklist";
import { formatAED } from "@/lib/format";
import type { UserProfile } from "@/lib/types";

import { fetchPriorities, priorityDisplayStatus, type AssignableUser, type Priority } from "./index";

export interface UserKpi {
  userId: string;
  name: string;
  email: string;
  tasksDone: number;
  tasksTotal: number;
  prioritiesOpen: number;
  prioritiesCompleted: number;
  prioritiesOverdue: number;
}

export interface WeeklySummary {
  date: string;
  users: UserKpi[];
  cocoblu: { openRecords: number; qtyRemaining: number; over90: number } | null;
  amazon: { openActions: number; missingDocs: number; overdue: number; exposure: number } | null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function priosFor(all: Priority[], userId: string): Priority[] {
  return all.filter((p) => p.assigned_to === userId || p.assigned_to_both === true);
}

/**
 * Live manager summary. Draft v1 — computes from daily_tasks/submissions
 * (via fetchChecklistForDate), priorities, cocoblu_ageing, expected_actions +
 * amazon_action_log. Each source is fail-soft so a permission gap on one
 * doesn't blank the whole summary.
 */
export async function buildWeeklySummary(
  managerProfile: UserProfile,
  staff: AssignableUser[]
): Promise<WeeklySummary> {
  const date = todayIso();

  const allPriorities = await fetchPriorities(managerProfile).catch(() => []);

  const users: UserKpi[] = [];
  for (const u of staff) {
    // Per-user checklist for today (manager scope returns all; we filter).
    let tasksDone = 0;
    let tasksTotal = 0;
    try {
      const tasks = await fetchChecklistForDate({ date, profile: managerProfile });
      const mine = tasks.filter((t) => t.assigned_to === u.id);
      tasksTotal = mine.length;
      tasksDone = mine.filter((t) => t.status === "submitted" || t.status === "verified").length;
    } catch {
      /* fail-soft */
    }

    const mineP = priosFor(allPriorities, u.id);
    users.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      tasksDone,
      tasksTotal,
      prioritiesOpen: mineP.filter((p) => {
        const s = priorityDisplayStatus(p);
        return s === "open" || s === "in_progress" || s === "overdue";
      }).length,
      prioritiesCompleted: mineP.filter((p) => priorityDisplayStatus(p) === "completed").length,
      prioritiesOverdue: mineP.filter((p) => priorityDisplayStatus(p) === "overdue").length,
    });
  }

  let cocoblu: WeeklySummary["cocoblu"] = null;
  try {
    const s = calculateCocobluSummary(await fetchCocobluAgeing());
    cocoblu = { openRecords: s.totalOpenRecords, qtyRemaining: s.totalQtyRemaining, over90: s.over90Records };
  } catch {
    /* fail-soft */
  }

  let amazon: WeeklySummary["amazon"] = null;
  try {
    const s = computeActionSummary(await fetchAmazonActions());
    amazon = {
      openActions: s.openCount,
      missingDocs: s.missingDocCount,
      overdue: s.overdueCount,
      exposure: s.exposure.total,
    };
  } catch {
    /* fail-soft */
  }

  return { date, users, cocoblu, amazon };
}

/** Render the summary as an HTML email body. */
export function renderWeeklySummaryHtml(s: WeeklySummary): string {
  const rows = s.users
    .map(
      (u) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${u.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${u.tasksDone}/${u.tasksTotal}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${u.prioritiesCompleted}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${u.prioritiesOpen}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${u.prioritiesOverdue > 0 ? "#dc2626" : "#111"}">${u.prioritiesOverdue}</td>
      </tr>`
    )
    .join("");
  const cocoblu = s.cocoblu
    ? `<p><b>Cocoblu (Aaron):</b> ${s.cocoblu.openRecords} open records · ${s.cocoblu.qtyRemaining} qty remaining · ${s.cocoblu.over90} aged 90+ days</p>`
    : "";
  const amazon = s.amazon
    ? `<p><b>Amazon Actions (Maricel):</b> ${s.amazon.openActions} open · ${s.amazon.missingDocs} missing docs · ${s.amazon.overdue} overdue · ${formatAED(s.amazon.exposure)} exposure</p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
    <h2 style="margin:0 0 4px">Weekly Operations Summary</h2>
    <p style="color:#666;margin:0 0 16px">As of ${s.date}</p>
    <table style="border-collapse:collapse;width:100%;max-width:560px">
      <thead><tr style="text-align:left;background:#f8fafc">
        <th style="padding:6px 10px">User</th><th style="padding:6px 10px">Tasks today</th>
        <th style="padding:6px 10px">Priorities done</th><th style="padding:6px 10px">Open</th>
        <th style="padding:6px 10px">Overdue</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${cocoblu}${amazon}
  </div>`;
}
