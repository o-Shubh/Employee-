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
    const missing = [...codes].filter((c) => !(c in en.errors));
    expect(missing).toEqual([]);
  });
});
