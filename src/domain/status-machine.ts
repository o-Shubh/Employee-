import type { LogType, WorkStatus } from "./types";

/** The status an employee is in after an entry of the given type. */
export function statusAfter(type: Exclude<LogType, "VOID">): WorkStatus {
  switch (type) {
    case "CHECK_IN":
    case "ON_DUTY":
      return "ON_DUTY";
    case "BREAK":
      return "BREAK";
    case "FIELD_DUTY":
      return "FIELD_DUTY";
    case "CHECK_OUT":
      return "OFF";
  }
}

/**
 * Allowed transitions. Same-status changes are rejected except BREAK→BREAK
 * (switching e.g. from Tea to Lunch) and FIELD→FIELD (new field assignment/note).
 */
const ALLOWED: Record<WorkStatus, ReadonlyArray<Exclude<LogType, "VOID">>> = {
  OFF: ["CHECK_IN"],
  ON_DUTY: ["BREAK", "FIELD_DUTY", "CHECK_OUT"],
  BREAK: ["ON_DUTY", "BREAK", "FIELD_DUTY", "CHECK_OUT"],
  FIELD_DUTY: ["ON_DUTY", "BREAK", "FIELD_DUTY", "CHECK_OUT"],
};

export type TransitionError = "NOT_CHECKED_IN" | "ALREADY_CHECKED_IN" | "INVALID_TRANSITION";

export function canTransition(
  from: WorkStatus,
  type: Exclude<LogType, "VOID">,
): { ok: true; to: WorkStatus } | { ok: false; error: TransitionError } {
  if (ALLOWED[from].includes(type)) return { ok: true, to: statusAfter(type) };
  if (from === "OFF") return { ok: false, error: "NOT_CHECKED_IN" };
  if (type === "CHECK_IN") return { ok: false, error: "ALREADY_CHECKED_IN" };
  return { ok: false, error: "INVALID_TRANSITION" };
}

export function allowedActions(from: WorkStatus): ReadonlyArray<Exclude<LogType, "VOID">> {
  return ALLOWED[from];
}
