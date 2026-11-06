import { normaliseIp } from "@/domain/cidr";

/**
 * Resolve the real client IP from forwarding headers.
 *
 * Each proxy APPENDS the address it received the connection from to
 * X-Forwarded-For, so only the right-most `hops` entries are trustworthy;
 * anything to the left could have been supplied by the client.
 *
 *   TRUST_PROXY_HOPS = N  →  client IP = XFF[len - N]
 *
 * The Next.js server itself appends the socket peer address, so for `next dev`
 * / `next start` with no proxy in front use 1; behind one reverse proxy
 * (nginx, ALB) use 2; and so on.
 */
export function resolveClientIp(headers: Headers, hops = trustedHops()): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff && hops > 0) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const candidate = parts[Math.max(0, parts.length - hops)];
    if (candidate) return normaliseIp(candidate);
  }
  const real = headers.get("x-real-ip");
  return real && hops > 0 ? normaliseIp(real) : null;
}

function trustedHops(): number {
  const n = Number(process.env.TRUST_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 0 ? n : 1;
}
