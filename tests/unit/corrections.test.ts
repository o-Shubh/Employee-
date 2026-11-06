import { describe, expect, it } from "vitest";
import { simulateCorrection } from "@/domain/corrections";
import type { TimelineEntry } from "@/domain/types";

const H = 3600_000;
const T0 = new Date("2026-03-02T03:30:00Z"); // 09:00 IST
const at = (h: number) => new Date(T0.getTime() + h * H);
const iso = (h: number) => at(h).toISOString();
const e = (id: string, type: TimelineEntry["type"], h: number, extra: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id, type, occurredAt: at(h), recordedAt: at(h), breakKind: type === "BREAK" ? "LUNCH" : null, ...extra,
});
const opts = { windowStart: at(-9), windowEnd: at(27), now: at(48) };

describe("correction simulation", () => {
  const missedOut = [e("in", "CHECK_IN", 0), e("b", "BREAK", 4), e("d", "ON_DUTY", 5)];

  it("adding a missing check-out closes the day", () => {
    const r = simulateCorrection(missedOut, [{ op: "ADD", type: "CHECK_OUT", occurredAt: iso(9) }], opts);
    expect(r).toMatchObject({ ok: true, workSeconds: 8 * 3600, breakSeconds: 3600 });
  });

  it("changing a wrong check-in time", () => {
    const day = [...missedOut, e("out", "CHECK_OUT", 9)];
    const r = simulateCorrection(day, [{ op: "CHANGE_TIME", entryId: "in", occurredAt: iso(-0.5) }], opts);
    expect(r).toMatchObject({ ok: true, workSeconds: 8.5 * 3600 });
  });

  it("adding a forgotten break (two entries)", () => {
    const day = [e("in", "CHECK_IN", 0), e("out", "CHECK_OUT", 9)];
    const r = simulateCorrection(day, [
      { op: "ADD", type: "BREAK", breakKind: "LUNCH", occurredAt: iso(4) },
      { op: "ADD", type: "ON_DUTY", occurredAt: iso(4.75) },
    ], opts);
    expect(r).toMatchObject({ ok: true, workSeconds: 8.25 * 3600, breakSeconds: 0.75 * 3600 });
  });

  it("removing an accidental entry", () => {
    const day = [e("in", "CHECK_IN", 0), e("oops", "BREAK", 1, { breakKind: "TEA" }), e("out", "CHECK_OUT", 9)];
    // removing the break leaves CHECK_IN → CHECK_OUT, which is valid
    expect(simulateCorrection(day, [{ op: "REMOVE", entryId: "oops" }], opts)).toMatchObject({ ok: true, workSeconds: 9 * 3600 });
  });

  it("rejects results that don't form a clean, closed day", () => {
    expect(simulateCorrection(missedOut, [{ op: "REMOVE", entryId: "b" }], opts)).toMatchObject({ ok: false, error: "RESULT_INVALID_SEQUENCE" });
    expect(simulateCorrection(missedOut, [{ op: "CHANGE_TIME", entryId: "d", occurredAt: iso(4.5) }], opts)).toMatchObject({ ok: false, error: "RESULT_NOT_CHECKED_OUT" });
  });

  it("validates input", () => {
    expect(simulateCorrection(missedOut, [], opts)).toMatchObject({ ok: false, error: "NO_CHANGES" });
    expect(simulateCorrection(missedOut, [{ op: "REMOVE", entryId: "nope" }], opts)).toMatchObject({ ok: false, error: "ENTRY_NOT_FOUND" });
    expect(simulateCorrection(missedOut, [{ op: "ADD", type: "CHECK_OUT", occurredAt: iso(50) }], opts)).toMatchObject({ ok: false, error: "TIME_OUT_OF_RANGE" });
    expect(simulateCorrection(missedOut, [{ op: "ADD", type: "CHECK_OUT", occurredAt: iso(30) }], { ...opts, windowEnd: at(40), now: at(20) })).toMatchObject({ ok: false, error: "TIME_IN_FUTURE" });
    expect(simulateCorrection(missedOut, [{ op: "ADD", type: "BREAK", occurredAt: iso(6) }], opts)).toMatchObject({ ok: false, error: "BREAK_KIND_REQUIRED" });
    expect(
      simulateCorrection(missedOut, [{ op: "REMOVE", entryId: "d" }, { op: "CHANGE_TIME", entryId: "d", occurredAt: iso(6) }], opts),
    ).toMatchObject({ ok: false, error: "ENTRY_CHANGED_TWICE" });
  });
});
