import { canTransition, statusAfter } from "./status-machine";
import type { BreakKind, TimelineEntry, WorkStatus } from "./types";

/**
 * Entries that are currently in force: drop any entry that a later correction
 * superseded, and drop VOID markers themselves. Sorted by occurredAt, then recordedAt.
 */
export function effectiveEntries<T extends TimelineEntry>(entries: readonly T[]): T[] {
  const superseded = new Set(entries.map((e) => e.supersedesId).filter((x): x is string => !!x));
  return entries
    .filter((e) => !superseded.has(e.id) && e.type !== "VOID")
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.recordedAt.getTime() - b.recordedAt.getTime(),
    );
}

export interface Segment {
  status: Exclude<WorkStatus, "OFF">;
  breakKind?: BreakKind | null;
  start: Date;
  /** null = still running (live) */
  end: Date | null;
  /** true when the segment was cut at its start because the day was never checked out */
  unbounded?: boolean;
}

export interface DayComputation {
  status: WorkStatus;
  /** When the current status started (null when OFF and nothing logged) */
  statusSince: Date | null;
  currentBreakKind: BreakKind | null;
  segments: Segment[];
  workSeconds: number; // ON_DUTY + FIELD_DUTY
  breakSeconds: number;
  fieldSeconds: number;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  /** Checked in but never checked out, and the shift is older than the stale threshold */
  missedCheckout: boolean;
  /** Sequence problems (e.g. two CHECK_INs in a row) — computed tolerantly, flagged for review */
  anomalies: string[];
}

export interface ComputeOptions {
  now: Date;
  /** After this long since CHECK_IN an open shift is treated as a missed check-out. */
  staleAfterMs: number;
}

/**
 * Replays a day's effective entries and computes status + totals.
 *
 * Rules:
 *  - Work time = ON_DUTY + FIELD_DUTY. Break time is tracked separately and is
 *    never deducted automatically from anything.
 *  - A live (open) segment runs until `now`.
 *  - If the shift was never checked out and is stale, the trailing open segment
 *    counts as ZERO (we never invent an end time); the day is flagged missedCheckout
 *    and the employee must file a correction.
 */
export function computeDay(entries: readonly TimelineEntry[], opts: ComputeOptions): DayComputation {
  const list = effectiveEntries(entries);
  const anomalies: string[] = [];
  const segments: Segment[] = [];
  let status: WorkStatus = "OFF";
  let statusSince: Date | null = null;
  let breakKind: BreakKind | null = null;
  let firstInAt: Date | null = null;
  let lastOutAt: Date | null = null;
  let lastCheckInAt: Date | null = null;

  const close = (at: Date) => {
    const open = segments[segments.length - 1];
    if (open && open.end === null) open.end = at;
  };

  for (const e of list) {
    if (e.type === "VOID") continue;
    const t = canTransition(status, e.type);
    if (!t.ok) anomalies.push(`${t.error}:${e.id}`);
    close(e.occurredAt);
    status = statusAfter(e.type);
    statusSince = e.occurredAt;
    breakKind = e.type === "BREAK" ? (e.breakKind ?? null) : null;
    if (e.type === "CHECK_IN") {
      firstInAt ??= e.occurredAt;
      lastCheckInAt = e.occurredAt;
    }
    if (e.type === "CHECK_OUT") lastOutAt = e.occurredAt;
    if (status !== "OFF") {
      segments.push({ status, breakKind, start: e.occurredAt, end: null });
    }
  }

  let missedCheckout = false;
  const open = segments[segments.length - 1];
  if (open && open.end === null) {
    const shiftStart = lastCheckInAt ?? open.start;
    if (opts.now.getTime() - shiftStart.getTime() > opts.staleAfterMs) {
      missedCheckout = true;
      open.end = open.start; // count nothing we cannot vouch for
      open.unbounded = true;
    }
  }

  let workSeconds = 0;
  let breakSeconds = 0;
  let fieldSeconds = 0;
  for (const s of segments) {
    const end = s.end ?? opts.now;
    const secs = Math.max(0, Math.floor((end.getTime() - s.start.getTime()) / 1000));
    if (s.status === "BREAK") breakSeconds += secs;
    else {
      workSeconds += secs;
      if (s.status === "FIELD_DUTY") fieldSeconds += secs;
    }
  }

  return {
    status: missedCheckout ? "OFF" : status,
    statusSince,
    currentBreakKind: missedCheckout ? null : breakKind,
    segments,
    workSeconds,
    breakSeconds,
    fieldSeconds,
    firstInAt,
    lastOutAt,
    missedCheckout,
    anomalies,
  };
}

export const toMinutes = (seconds: number) => Math.floor(seconds / 60);

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
