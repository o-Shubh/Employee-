import ipaddr from "ipaddr.js";

type Parsed = [ipaddr.IPv4 | ipaddr.IPv6, number];

/** Normalise IPv4-mapped IPv6 ("::ffff:10.0.0.1") to plain IPv4. */
function parseAddr(ip: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const cleaned = ip.trim().replace(/^\[|\]$/g, "").replace(/%.+$/, "");
  if (!ipaddr.isValid(cleaned)) return null;
  return ipaddr.process(cleaned);
}

/** Parse "a.b.c.d/nn", "v6::/nn" or a bare address (treated as /32 or /128). */
export function parseCidr(input: string): Parsed | null {
  const s = input.trim();
  if (!s) return null;
  try {
    if (s.includes("/")) {
      const [addr, bits] = ipaddr.parseCIDR(s);
      const norm = addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()
        ? (addr as ipaddr.IPv6).toIPv4Address()
        : addr;
      const prefix = norm.kind() !== addr.kind() ? bits - 96 : bits;
      if (prefix < 0) return null;
      return [norm, prefix];
    }
    const addr = parseAddr(s);
    if (!addr) return null;
    return [addr, addr.kind() === "ipv4" ? 32 : 128];
  } catch {
    return null;
  }
}

export function isValidCidr(input: string): boolean {
  return parseCidr(input) !== null;
}

/** True when `ip` falls inside any of the CIDR ranges. Invalid input never matches. */
export function isIpAllowed(ip: string | null | undefined, cidrs: readonly string[]): boolean {
  if (!ip) return false;
  const addr = parseAddr(ip);
  if (!addr) return false;
  for (const c of cidrs) {
    const range = parseCidr(c);
    if (!range) continue;
    if (range[0].kind() !== addr.kind()) continue;
    if (addr.match(range)) return true;
  }
  return false;
}

export function normaliseIp(ip: string): string | null {
  return parseAddr(ip)?.toString() ?? null;
}
