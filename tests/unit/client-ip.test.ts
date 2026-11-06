import { describe, expect, it } from "vitest";
import { resolveClientIp } from "@/server/security/client-ip";

const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

describe("client IP resolution (anti-spoofing)", () => {
  it("with 1 trusted hop, uses the address appended by our own server", () => {
    expect(resolveClientIp(h("203.0.113.9"), 1)).toBe("203.0.113.9");
    // a client-supplied fake prefix is ignored
    expect(resolveClientIp(h("10.0.0.1, 203.0.113.9"), 1)).toBe("203.0.113.9");
  });
  it("with 2 hops (reverse proxy + server), takes the second from the right", () => {
    expect(resolveClientIp(h("10.0.0.1, 198.51.100.4, 172.18.0.2"), 2)).toBe("198.51.100.4");
  });
  it("normalises IPv4-mapped IPv6 and rejects garbage", () => {
    expect(resolveClientIp(h("::ffff:127.0.0.1"), 1)).toBe("127.0.0.1");
    expect(resolveClientIp(h("not-an-ip"), 1)).toBeNull();
    expect(resolveClientIp(h(), 1)).toBeNull();
    expect(resolveClientIp(h("203.0.113.9"), 0)).toBeNull();
  });
});
