import { describe, expect, it } from "vitest";
import { addDaysKey, dateKeyToDb, dbToDateKey, isDateKey, isoWeekday, localDateKey, localToUtc, monthDateKeys, startOfLocalDay } from "@/domain/time";

describe("time zone helpers", () => {
  it("local date differs from UTC date around midnight IST", () => {
    const instant = new Date("2026-03-02T19:00:00Z"); // 00:30 IST on 3 March
    expect(localDateKey(instant, "Asia/Kolkata")).toBe("2026-03-03");
    expect(localDateKey(instant, "UTC")).toBe("2026-03-02");
  });

  it("local wall time to UTC (IST is +05:30)", () => {
    expect(localToUtc("2026-03-02", "09:30", "Asia/Kolkata").toISOString()).toBe("2026-03-02T04:00:00.000Z");
    expect(startOfLocalDay("2026-03-02", "Asia/Kolkata").toISOString()).toBe("2026-03-01T18:30:00.000Z");
  });

  it("handles DST zones", () => {
    // New York switches to DST on 2026-03-08
    expect(localToUtc("2026-03-09", "09:00", "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(localToUtc("2026-03-06", "09:00", "America/New_York").toISOString()).toBe("2026-03-06T14:00:00.000Z");
  });

  it("date keys round-trip through DB representation", () => {
    expect(dbToDateKey(dateKeyToDb("2026-12-31"))).toBe("2026-12-31");
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-2-3")).toBe(false);
    expect(() => dateKeyToDb("nope")).toThrow();
  });

  it("calendar helpers", () => {
    expect(monthDateKeys(2028, 2)).toHaveLength(29);
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoWeekday("2026-11-08")).toBe(7); // Sunday
    expect(isoWeekday("2026-11-09")).toBe(1);
  });
});
