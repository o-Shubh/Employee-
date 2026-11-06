import { describe, expect, it } from "vitest";
import { computeDay, effectiveEntries, formatDuration } from "@/domain/timeline";
import type { TimelineEntry } from "@/domain/types";

const H = 3600_000;
const STALE = 16 * H;
const base = new Date("2026-03-02T03:30:00Z"); // 09:00 IST
const at = (hours: number) => new Date(base.getTime() + hours * H);
let n = 0;
const e = (type: TimelineEntry["type"], hours: number, extra: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: `e${++n}`,
  type,
  occurredAt: at(hours),
  recordedAt: at(hours),
  breakKind: type === "BREAK" ? "LUNCH" : null,
  ...extra,
});

describe("computeDay — hours calculation", () => {
  it("empty day is OFF with zero totals", () => {
    const r = computeDay([], { now: at(5), staleAfterMs: STALE });
    expect(r).toMatchObject({ status: "OFF", workSeconds: 0, breakSeconds: 0, firstInAt: null });
  });

  it("standard 9h day with a 1h lunch: 8h work, 1h break", () => {
    const r = computeDay(
      [e("CHECK_IN", 0), e("BREAK", 4), e("ON_DUTY", 5), e("CHECK_OUT", 9)],
      { now: at(12), staleAfterMs: STALE },
    );
    expect(r.workSeconds).toBe(8 * 3600);
    expect(r.breakSeconds).toBe(3600);
    expect(r.status).toBe("OFF");
    expect(r.firstInAt).toEqual(at(0));
    expect(r.lastOutAt).toEqual(at(9));
    expect(r.missedCheckout).toBe(false);
    expect(r.anomalies).toEqual([]);
  });

  it("field duty counts as work and is also reported separately", () => {
    const r = computeDay(
      [e("CHECK_IN", 0), e("FIELD_DUTY", 2, { note: "Site visit" }), e("ON_DUTY", 5), e("CHECK_OUT", 8)],
      { now: at(9), staleAfterMs: STALE },
    );
    expect(r.workSeconds).toBe(8 * 3600);
    expect(r.fieldSeconds).toBe(3 * 3600);
    expect(r.breakSeconds).toBe(0);
  });

  it("live day: open segment runs until now", () => {
    const r = computeDay([e("CHECK_IN", 0), e("BREAK", 2)], { now: at(2.5), staleAfterMs: STALE });
    expect(r.status).toBe("BREAK");
    expect(r.currentBreakKind).toBe("LUNCH");
    expect(r.statusSince).toEqual(at(2));
    expect(r.workSeconds).toBe(2 * 3600);
    expect(r.breakSeconds).toBe(1800);
  });

  it("switching break kind (tea → lunch) keeps it all as break", () => {
    const r = computeDay(
      [e("CHECK_IN", 0), e("BREAK", 1, { breakKind: "TEA" }), e("BREAK", 1.25, { breakKind: "LUNCH" }), e("ON_DUTY", 2), e("CHECK_OUT", 3)],
      { now: at(4), staleAfterMs: STALE },
    );
    expect(r.breakSeconds).toBe(3600);
    expect(r.workSeconds).toBe(2 * 3600);
  });

  it("night shift crossing midnight is one continuous day", () => {
    const start = new Date("2026-03-02T16:30:00Z"); // 22:00 IST
    const mk = (type: TimelineEntry["type"], h: number): TimelineEntry => ({
      id: `${type}${h}`, type, occurredAt: new Date(start.getTime() + h * H), recordedAt: new Date(start.getTime() + h * H),
      breakKind: type === "BREAK" ? "TEA" : null,
    });
    const r = computeDay([mk("CHECK_IN", 0), mk("BREAK", 3), mk("ON_DUTY", 3.5), mk("CHECK_OUT", 8)], {
      now: new Date(start.getTime() + 9 * H), staleAfterMs: STALE,
    });
    expect(r.workSeconds).toBe(7.5 * 3600);
    expect(r.breakSeconds).toBe(1800);
  });

  it("missed check-out: never invents an end time — trailing segment counts zero", () => {
    const r = computeDay([e("CHECK_IN", 0), e("BREAK", 4), e("ON_DUTY", 5)], { now: at(30), staleAfterMs: STALE });
    expect(r.missedCheckout).toBe(true);
    expect(r.status).toBe("OFF");
    expect(r.workSeconds).toBe(4 * 3600); // only the bounded 09:00–13:00 segment
    expect(r.breakSeconds).toBe(3600);
    expect(r.segments.at(-1)?.unbounded).toBe(true);
  });

  it("re-check-in after check-out the same day accumulates", () => {
    const r = computeDay(
      [e("CHECK_IN", 0), e("CHECK_OUT", 3), e("CHECK_IN", 5), e("CHECK_OUT", 7)],
      { now: at(8), staleAfterMs: STALE },
    );
    expect(r.workSeconds).toBe(5 * 3600);
    expect(r.firstInAt).toEqual(at(0));
    expect(r.lastOutAt).toEqual(at(7));
  });

  it("is tolerant of bad sequences but flags them", () => {
    const r = computeDay([e("CHECK_IN", 0), e("CHECK_IN", 1), e("CHECK_OUT", 2)], { now: at(3), staleAfterMs: STALE });
    expect(r.workSeconds).toBe(2 * 3600);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]).toMatch(/^ALREADY_CHECKED_IN/);
  });

  it("orders by occurredAt even when back-dated entries were recorded later", () => {
    const late = e("BREAK", 2, { recordedAt: at(3), source: undefined } as Partial<TimelineEntry>);
    const r = computeDay([e("CHECK_IN", 0), e("ON_DUTY", 3), late, e("CHECK_OUT", 4)].sort(() => -1), {
      now: at(5), staleAfterMs: STALE,
    });
    expect(r.breakSeconds).toBe(3600);
    expect(r.workSeconds).toBe(3 * 3600);
  });
});

describe("effectiveEntries — corrections", () => {
  it("superseded entries and VOID markers are excluded; originals untouched", () => {
    const original = e("CHECK_OUT", 9);
    const fix = e("CHECK_OUT", 10, { supersedesId: original.id });
    const wrongBreak = e("BREAK", 4);
    const voided = e("VOID", 4, { supersedesId: wrongBreak.id });
    const all = [e("CHECK_IN", 0), wrongBreak, original, fix, voided];
    const eff = effectiveEntries(all);
    expect(eff.map((x) => x.id)).not.toContain(original.id);
    expect(eff.map((x) => x.id)).not.toContain(wrongBreak.id);
    expect(eff.map((x) => x.id)).toContain(fix.id);
    expect(eff.some((x) => x.type === "VOID")).toBe(false);
    expect(all).toHaveLength(5); // input not mutated
    const r = computeDay(all, { now: at(12), staleAfterMs: STALE });
    expect(r.workSeconds).toBe(10 * 3600);
  });
});

describe("formatDuration", () => {
  it("formats HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(8 * 3600 + 5 * 60 + 9)).toBe("08:05:09");
  });
});
