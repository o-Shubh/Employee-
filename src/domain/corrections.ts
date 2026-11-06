import { computeDay, effectiveEntries } from "./timeline";
import type { BreakKind, LogType, TimelineEntry } from "./types";

export type CorrectionOp =
  | { op: "ADD"; type: Exclude<LogType, "VOID">; occurredAt: string; breakKind?: BreakKind | null; note?: string | null }
  | { op: "CHANGE_TIME"; entryId: string; occurredAt: string }
  | { op: "REMOVE"; entryId: string };

export type CorrectionError =
  | "NO_CHANGES"
  | "TOO_MANY_CHANGES"
  | "ENTRY_NOT_FOUND"
  | "ENTRY_CHANGED_TWICE"
  | "TIME_OUT_OF_RANGE"
  | "TIME_IN_FUTURE"
  | "BREAK_KIND_REQUIRED"
  | "FIELD_NOTE_REQUIRED"
  | "RESULT_INVALID_SEQUENCE"
  | "RESULT_NOT_CHECKED_OUT";

/**
 * Applies proposed ops to the day's CURRENT effective entries (in memory only) and
 * checks the result is a clean, closed day. Used both when the employee files the
 * request (preview) and again when the manager approves (the day may have changed).
 */
export function simulateCorrection(
  entries: readonly TimelineEntry[],
  ops: readonly CorrectionOp[],
  opts: { windowStart: Date; windowEnd: Date; now: Date },
): { ok: true; result: TimelineEntry[]; workSeconds: number; breakSeconds: number } | { ok: false; error: CorrectionError; index?: number } {
  if (ops.length === 0) return { ok: false, error: "NO_CHANGES" };
  if (ops.length > 20) return { ok: false, error: "TOO_MANY_CHANGES" };
  const current = effectiveEntries(entries);
  const byId = new Map(current.map((e) => [e.id, e]));
  const touched = new Set<string>();
  let result = [...current];

  for (const [i, op] of ops.entries()) {
    if (op.op !== "ADD") {
      if (!byId.has(op.entryId)) return { ok: false, error: "ENTRY_NOT_FOUND", index: i };
      if (touched.has(op.entryId)) return { ok: false, error: "ENTRY_CHANGED_TWICE", index: i };
      touched.add(op.entryId);
    }
    if (op.op !== "REMOVE") {
      const t = new Date(op.occurredAt);
      if (Number.isNaN(t.getTime()) || t < opts.windowStart || t >= opts.windowEnd) return { ok: false, error: "TIME_OUT_OF_RANGE", index: i };
      if (t > opts.now) return { ok: false, error: "TIME_IN_FUTURE", index: i };
    }
    if (op.op === "ADD") {
      if (op.type === "BREAK" && !op.breakKind) return { ok: false, error: "BREAK_KIND_REQUIRED", index: i };
      if (op.type === "FIELD_DUTY" && !op.note?.trim()) return { ok: false, error: "FIELD_NOTE_REQUIRED", index: i };
      const t = new Date(op.occurredAt);
      result.push({ id: `new-${i}`, type: op.type, breakKind: op.type === "BREAK" ? op.breakKind : null, note: op.note ?? null, occurredAt: t, recordedAt: opts.now });
    } else if (op.op === "CHANGE_TIME") {
      const t = new Date(op.occurredAt);
      result = result.map((e) => (e.id === op.entryId ? { ...e, id: `chg-${i}`, occurredAt: t, recordedAt: opts.now } : e));
    } else {
      result = result.filter((e) => e.id !== op.entryId);
    }
  }

  const comp = computeDay(result, { now: opts.now, staleAfterMs: Number.MAX_SAFE_INTEGER });
  if (comp.anomalies.length) return { ok: false, error: "RESULT_INVALID_SEQUENCE" };
  if (comp.status !== "OFF") return { ok: false, error: "RESULT_NOT_CHECKED_OUT" };
  return { ok: true, result: effectiveEntries(result), workSeconds: comp.workSeconds, breakSeconds: comp.breakSeconds };
}
