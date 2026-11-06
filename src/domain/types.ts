// Pure domain types. No Prisma / Next imports here so this layer is trivially testable
// and can be shared with client components.

export type LogType = "CHECK_IN" | "ON_DUTY" | "BREAK" | "FIELD_DUTY" | "CHECK_OUT" | "VOID";
export type BreakKind = "LUNCH" | "TEA" | "PERSONAL";
export type EntrySource = "SELF" | "IDLE_PROMPT" | "CORRECTION" | "SYSTEM";

/** What the employee is doing right now. */
export type WorkStatus = "OFF" | "ON_DUTY" | "BREAK" | "FIELD_DUTY";

export interface TimelineEntry {
  id: string;
  type: LogType;
  breakKind?: BreakKind | null;
  note?: string | null;
  occurredAt: Date;
  recordedAt: Date;
  supersedesId?: string | null;
}

export const BREAK_KINDS: readonly BreakKind[] = ["LUNCH", "TEA", "PERSONAL"] as const;
