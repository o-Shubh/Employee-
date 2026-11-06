import { describe, expect, it } from "vitest";
import { isIpAllowed, isValidCidr } from "@/domain/cidr";

describe("office IP allow-list", () => {
  const office = ["203.0.113.0/24", "10.20.0.0/16", "2001:db8:abcd::/48", "198.51.100.7"];

  it.each([
    ["203.0.113.45", true],
    ["203.0.114.1", false],
    ["10.20.255.1", true],
    ["10.21.0.1", false],
    ["198.51.100.7", true],
    ["198.51.100.8", false],
    ["2001:db8:abcd:12::1", true],
    ["2001:db8:abce::1", false],
    ["::ffff:203.0.113.9", true], // IPv4-mapped IPv6 from dual-stack sockets
    ["[2001:db8:abcd::5]", true],
  ])("%s → %s", (ip, ok) => expect(isIpAllowed(ip, office)).toBe(ok));

  it("never matches garbage or empty input", () => {
    expect(isIpAllowed("", office)).toBe(false);
    expect(isIpAllowed(null, office)).toBe(false);
    expect(isIpAllowed("not-an-ip", office)).toBe(false);
    expect(isIpAllowed("203.0.113.5", [])).toBe(false);
    expect(isIpAllowed("203.0.113.5", ["garbage/99"])).toBe(false);
  });

  it("validates admin input", () => {
    expect(isValidCidr("192.168.1.0/24")).toBe(true);
    expect(isValidCidr("192.168.1.0/33")).toBe(false);
    expect(isValidCidr("::1")).toBe(true);
    expect(isValidCidr("hello")).toBe(false);
    expect(isValidCidr("::ffff:10.0.0.0/104")).toBe(true);
    expect(isIpAllowed("10.9.9.9", ["::ffff:10.0.0.0/104"])).toBe(true);
  });
});
