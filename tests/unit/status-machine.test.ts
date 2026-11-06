import { describe, expect, it } from "vitest";
import { allowedActions, canTransition } from "@/domain/status-machine";

describe("status machine", () => {
  it("only allows CHECK_IN when off", () => {
    expect(allowedActions("OFF")).toEqual(["CHECK_IN"]);
    expect(canTransition("OFF", "BREAK")).toEqual({ ok: false, error: "NOT_CHECKED_IN" });
    expect(canTransition("OFF", "CHECK_OUT")).toEqual({ ok: false, error: "NOT_CHECKED_IN" });
  });

  it("rejects a second CHECK_IN while on duty", () => {
    expect(canTransition("ON_DUTY", "CHECK_IN")).toEqual({ ok: false, error: "ALREADY_CHECKED_IN" });
    expect(canTransition("BREAK", "CHECK_IN")).toEqual({ ok: false, error: "ALREADY_CHECKED_IN" });
  });

  it("rejects no-op ON_DUTY → ON_DUTY", () => {
    expect(canTransition("ON_DUTY", "ON_DUTY")).toEqual({ ok: false, error: "INVALID_TRANSITION" });
  });

  it.each([
    ["ON_DUTY", "BREAK", "BREAK"],
    ["ON_DUTY", "FIELD_DUTY", "FIELD_DUTY"],
    ["ON_DUTY", "CHECK_OUT", "OFF"],
    ["BREAK", "ON_DUTY", "ON_DUTY"],
    ["BREAK", "BREAK", "BREAK"],
    ["FIELD_DUTY", "ON_DUTY", "ON_DUTY"],
    ["FIELD_DUTY", "CHECK_OUT", "OFF"],
  ] as const)("%s --%s--> %s", (from, type, to) => {
    expect(canTransition(from, type)).toEqual({ ok: true, to });
  });
});
