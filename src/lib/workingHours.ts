/**
 * Working-hours utilities (Dubai timezone, UTC+4).
 *
 * Schedule:
 *   Monday–Friday : 09:30 – 18:30  (540 min/day)
 *   Saturday      : 09:30 – 14:00  (270 min/day)
 *   Sunday        : closed
 */

const DUBAI_OFFSET_MS = 4 * 60 * 60_000; // UTC+4

/** Convert a UTC Date to its Dubai-local representation (fields via getUTC*). */
function toDubai(d: Date): Date {
  return new Date(d.getTime() + DUBAI_OFFSET_MS);
}

/** Working-day start in minutes-from-midnight (Dubai local). null = closed. */
function dayStart(dow: number): number | null {
  return dow === 0 ? null : 9 * 60 + 30; // 09:30; Sunday (0) closed
}

/** Working-day end in minutes-from-midnight (Dubai local). null = closed. */
function dayEnd(dow: number): number | null {
  if (dow === 0) return null;
  if (dow === 6) return 14 * 60; // Saturday 14:00
  return 18 * 60 + 30; // Monday–Friday 18:30
}

/**
 * Returns the UTC timestamp of the next moment that falls inside working hours
 * at or after `d`. If `d` is already inside working hours, returns `d` unchanged.
 */
export function nextWorkingMoment(d: Date): Date {
  let cursor = new Date(d);
  for (let guard = 0; guard < 14; guard++) {
    const local = toDubai(cursor);
    const dow = local.getUTCDay();
    const minOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
    const wS = dayStart(dow);
    const wE = dayEnd(dow);

    if (wS != null && wE != null) {
      if (minOfDay >= wS && minOfDay < wE) return cursor; // already inside
      if (minOfDay < wS) {
        // Before today's shift — jump to shift start
        return new Date(cursor.getTime() + (wS - minOfDay) * 60_000);
      }
    }
    // After shift (or Sunday) — jump to midnight Dubai and try next day
    const dubaiMidnightUtcMs =
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - DUBAI_OFFSET_MS;
    cursor = new Date(dubaiMidnightUtcMs);
  }
  return cursor; // fallback (shouldn't reach)
}

/**
 * Count working minutes between two UTC timestamps.
 * Only minutes within the Mon–Sat schedule above are counted.
 */
export function workingMinutesBetween(from: Date, to: Date): number {
  if (from >= to) return 0;

  let total = 0;
  let cursor = nextWorkingMoment(from);

  for (let guard = 0; guard < 500 && cursor < to; guard++) {
    const local = toDubai(cursor);
    const dow = local.getUTCDay();
    const minOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
    const wE = dayEnd(dow);
    if (wE == null) { cursor = nextWorkingMoment(new Date(cursor.getTime() + 60_000)); continue; }

    // End of this shift in UTC
    const shiftEndUtc = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      DUBAI_OFFSET_MS + wE * 60_000
    );

    const segEnd = to < shiftEndUtc ? to : shiftEndUtc;
    total += Math.round((segEnd.getTime() - cursor.getTime()) / 60_000);

    if (to >= shiftEndUtc) {
      cursor = nextWorkingMoment(new Date(shiftEndUtc.getTime() + 60_000));
    } else {
      break;
    }
  }
  return total;
}

/**
 * Working minutes elapsed since `messageAt`, treating now as the upper bound.
 * If the message arrived outside working hours, the clock starts at the next
 * working moment (so a Sunday message shows 0 until Monday 09:30).
 */
export function workingWaitMinutes(messageAt: Date, now: Date = new Date()): number {
  const effectiveStart = nextWorkingMoment(messageAt);
  if (effectiveStart >= now) return 0;
  return workingMinutesBetween(effectiveStart, now);
}

/**
 * Format working minutes for display: "3771m" → "10h 30m" or just "45m".
 */
export function fmtWorkingMin(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Working response minutes: given a raw `response_minutes` (wall-clock) stored
 * at webhook time, derive the actual working minutes Aaron took to reply.
 * Uses `message_at` + `response_minutes` to reconstruct `responded_at`, then
 * counts working minutes from the effective SLA start (next working moment).
 */
export function workingResponseMinutes(
  messageAt: string,
  responseMinutes: number
): number {
  const msgDate = new Date(messageAt);
  const respondedAt = new Date(msgDate.getTime() + responseMinutes * 60_000);
  const slaStart = nextWorkingMoment(msgDate);
  if (respondedAt <= slaStart) return 0; // replied before shift even started
  return workingMinutesBetween(slaStart, respondedAt);
}
