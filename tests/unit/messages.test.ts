import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("i18n catalogue", () => {
  it("every AppError code thrown in src/ has an English message", () => {
    const codes = new Set<string>();
    for (const f of files("src")) {
      for (const m of readFileSync(f, "utf8").matchAll(/new AppError\("([A-Z_]+)"/g)) codes.add(m[1]!);
    }
    // codes produced dynamically
    for (const c of ["NOT_CHECKED_IN", "ALREADY_CHECKED_IN", "INVALID_TRANSITION", "NO_OFFICE_NETWORK", "IP_NOT_ALLOWED", "DEVICE_NOT_REGISTERED", "DEVICE_PENDING", "DEVICE_REVOKED", "PASSWORD_TOO_SHORT", "PASSWORD_NEEDS_LETTER_AND_DIGIT"]) codes.add(c);
    // LEAVE_* / CORRECTION_* codes built from domain errors
    for (const c of ["END_BEFORE_START", "HALF_DAY_BOTH_SAME_DAY", "SPANS_YEARS", "TOO_LONG", "NO_WORKING_DAYS", "DATE_INVALID"]) codes.add(`LEAVE_${c}`);
    for (const c of ["NO_CHANGES", "TOO_MANY_CHANGES", "ENTRY_NOT_FOUND", "ENTRY_CHANGED_TWICE", "TIME_OUT_OF_RANGE", "TIME_IN_FUTURE", "BREAK_KIND_REQUIRED", "FIELD_NOTE_REQUIRED", "RESULT_INVALID_SEQUENCE", "RESULT_NOT_CHECKED_OUT"]) codes.add(`CORRECTION_${c}`);
    const missing = [...codes].filter((c) => !(c in en.errors));
    expect(missing).toEqual([]);
  });
});
