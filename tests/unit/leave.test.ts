import { describe, expect, it } from "vitest";
import { countLeaveDays, spansOverlap, sumBalance, type WorkCalendar } from "@/domain/leave";

const cal: WorkCalendar = { weeklyOff: new Set([6, 7]), holidays: new Set(["2026-11-09"]) };
// Nov 2026: Fri 6, Sat 7, Sun 8, Mon 9 (holiday), Tue 10
const span = (start: string, end: string, halfDayStart = false, halfDayEnd = false) => ({ start, end, halfDayStart, halfDayEnd });

describe("leave day counting", () => {
  it("counts working days only (weekends and holidays are free)", () => {
    expect(countLeaveDays(span("2026-11-06", "2026-11-10"), cal)).toMatchObject({ ok: true, days: 2, dates: ["2026-11-06", "2026-11-10"] });
    expect(countLeaveDays(span("2026-11-02", "2026-11-06"), cal)).toMatchObject({ ok: true, days: 5 });
  });
  it("half days", () => {
    expect(countLeaveDays(span("2026-11-06", "2026-11-06", true), cal)).toMatchObject({ days: 0.5 });
    expect(countLeaveDays(span("2026-11-05", "2026-11-06", true, true), cal)).toMatchObject({ days: 1 });
    // half day on a weekend end doesn't reduce anything
    expect(countLeaveDays(span("2026-11-06", "2026-11-07", false, true), cal)).toMatchObject({ days: 1 });
  });
  it("rejects invalid spans", () => {
    expect(countLeaveDays(span("2026-11-06", "2026-11-05"), cal)).toEqual({ ok: false, error: "END_BEFORE_START" });
    expect(countLeaveDays(span("2026-11-06", "2026-11-06", true, true), cal)).toEqual({ ok: false, error: "HALF_DAY_BOTH_SAME_DAY" });
    expect(countLeaveDays(span("2026-11-07", "2026-11-09"), cal)).toEqual({ ok: false, error: "NO_WORKING_DAYS" });
    expect(countLeaveDays(span("2026-12-30", "2027-01-02"), cal)).toEqual({ ok: false, error: "SPANS_YEARS" });
  });
  it("overlap and balance helpers", () => {
    expect(spansOverlap({ start: "2026-11-01", end: "2026-11-05" }, { start: "2026-11-05", end: "2026-11-08" })).toBe(true);
    expect(spansOverlap({ start: "2026-11-01", end: "2026-11-04" }, { start: "2026-11-05", end: "2026-11-08" })).toBe(false);
    expect(sumBalance([{ days: 12 }, { days: -1.5 }, { days: -0.5 }, { days: 0.5 }])).toBe(10.5);
  });
});
