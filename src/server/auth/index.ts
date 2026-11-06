import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prismaUnscoped as db } from "../db/client";
import { resolveClientIp } from "../security/client-ip";
import { rateLimit } from "../security/rate-limit";
import { dummyVerify, verifyPassword } from "./password";

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 12 * 3600 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentials.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = resolveClientIp(request.headers);
        if (!rateLimit(`login:${email}`, 8, 15 * 60_000) || !rateLimit(`login-ip:${ip}`, 40, 15 * 60_000)) {
          throw new RateLimited();
        }

        const user = await db.user.findUnique({ where: { email }, include: { tenant: { select: { status: true } } } });
        if (!user) {
          await dummyVerify(password);
          return null;
        }
        const ok = await verifyPassword(user.passwordHash, password);
        const blocked = user.status !== "ACTIVE" || (user.tenant && user.tenant.status !== "ACTIVE");
        await db.auditEvent.create({
          data: {
            tenantId: user.tenantId,
            actorUserId: user.id,
            action: ok && !blocked ? "auth.login" : "auth.login_failed",
            entityType: "User",
            entityId: user.id,
            reason: ok ? (blocked ? "ACCOUNT_OR_TENANT_DISABLED" : null) : "BAD_PASSWORD",
            ip,
          },
        });
        if (!ok || blocked) return null;
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
