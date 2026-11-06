import { addDaysKey, isoWeekday, type DateKey } from "./time";

export interface WorkCalendar {
  /** ISO weekdays that are off (6 = Sat, 7 = Sun) */
  weeklyOff: ReadonlySet<number>;
  /** Holiday date keys (Phase 3 holiday calendar plugs in here) */
  holidays: ReadonlySet<DateKey>;
}

export const isWorkingDay = (key: DateKey, cal: WorkCalendar) => !cal.weeklyOff.has(isoWeekday(key)) && !cal.holidays.has(key);

export interface LeaveSpan {
  start: DateKey;
  end: DateKey;
  /** begins at the second half of `start` */
  halfDayStart: boolean;
  /** ends after the first half of `end` */
  halfDayEnd: boolean;
}

export type LeaveSpanError = "END_BEFORE_START" | "HALF_DAY_BOTH_SAME_DAY" | "SPANS_YEARS" | "TOO_LONG" | "NO_WORKING_DAYS";

/**
 * Leave days charged for a span: working days only (weekly offs and holidays are
 * free), with half-day adjustments applied only when that end is a working day.
 */
export function countLeaveDays(span: LeaveSpan, cal: WorkCalendar): { ok: true; days: number; dates: DateKey[] } | { ok: false; error: LeaveSpanError } {
  if (span.end < span.start) return { ok: false, error: "END_BEFORE_START" };
  if (span.start === span.end && span.halfDayStart && span.halfDayEnd) return { ok: false, error: "HALF_DAY_BOTH_SAME_DAY" };
  if (span.start.slice(0, 4) !== span.end.slice(0, 4)) return { ok: false, error: "SPANS_YEARS" };
  const dates: DateKey[] = [];
  for (let d = span.start; d <= span.end; d = addDaysKey(d, 1)) {
    if (dates.length > 366) return { ok: false, error: "TOO_LONG" };
    if (isWorkingDay(d, cal)) dates.push(d);
  }
  let days = dates.length;
  if (span.halfDayStart && isWorkingDay(span.start, cal)) days -= 0.5;
  if (span.halfDayEnd && isWorkingDay(span.end, cal)) days -= 0.5;
  if (days <= 0) return { ok: false, error: "NO_WORKING_DAYS" };
  return { ok: true, days, dates };
}

export const spansOverlap = (a: { start: DateKey; end: DateKey }, b: { start: DateKey; end: DateKey }) => a.start <= b.end && b.start <= a.end;

/** Ledger rows → balance (rounded to 0.5 precision to avoid float drift). */
export function sumBalance(rows: readonly { days: number }[]): number {
  return Math.round(rows.reduce((a, r) => a + r.days, 0) * 2) / 2;
}
