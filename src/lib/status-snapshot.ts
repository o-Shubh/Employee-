import type { BreakKind, WorkStatus } from "@/domain/types";

/** JSON-safe status shared between server and the client widget. */
export interface StatusSnapshot {
  status: WorkStatus;
  statusSince: string | null;
  currentBreakKind: BreakKind | null;
  workSeconds: number;
  breakSeconds: number;
  fieldSeconds: number;
  firstInAt: string | null;
  asOf: string;
  workDate: string;
  timezone: string;
  idleTimeoutMin: number;
  requirePhoto: boolean;
  missedCheckoutOn: string | null;
  /** A closed day awaiting the employee's summary + certification */
  certifyDate: string | null;
  /** Approved leave covering today (type name), if any */
  leaveToday: string | null;
}

/** Live totals at `nowMs`, extrapolated from the snapshot without another server call. */
export function liveTotals(s: StatusSnapshot, nowMs: number) {
  const elapsed = Math.max(0, Math.floor((nowMs - Date.parse(s.asOf)) / 1000));
  const sinceSecs = s.statusSince ? Math.max(0, Math.floor((nowMs - Date.parse(s.statusSince)) / 1000)) : 0;
  return {
    work: s.workSeconds + (s.status === "ON_DUTY" || s.status === "FIELD_DUTY" ? elapsed : 0),
    brk: s.breakSeconds + (s.status === "BREAK" ? elapsed : 0),
    field: s.fieldSeconds + (s.status === "FIELD_DUTY" ? elapsed : 0),
    inStatus: s.status === "OFF" ? 0 : sinceSecs,
  };
}

/** Same output on server and client (avoids hydration mismatches from locale defaults). */
export function clock(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
}
