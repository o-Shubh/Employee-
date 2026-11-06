import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvObjects, toCsv } from "@/domain/csv";

describe("csv", () => {
  it("parses quotes, escaped quotes, CRLF and BOM", () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n3,\n';
    expect(parseCsv(text)).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["3", ""]]);
  });
  it("maps headers case-insensitively", () => {
    expect(parseCsvObjects("Email, Full Name\nA@x.com, Asha \n")).toEqual([{ email: "A@x.com", "full name": "Asha" }]);
  });
  it("escapes output and neutralises formula injection", () => {
    expect(toCsv([["a,b", '"q"', "=SUM(A1)", 5, null]])).toBe('"a,b","""q""",\'=SUM(A1),5,\r\n');
  });
});
