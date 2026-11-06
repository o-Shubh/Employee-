import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prismaUnscoped as db } from "../db/client";
import { AppError } from "../errors";
import { appUrl, sendEmails } from "../mail";
import { rateLimit } from "../security/rate-limit";
import { hashPassword, passwordProblem } from "./password";

const TTL_MS = 30 * 60_000;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Always behaves the same whether or not the email exists (no account enumeration).
 * The link is single-use, expires in 30 minutes, and only its hash is stored.
 */
export async function requestPasswordReset(emailRaw: string, ip: string | null, now = new Date()) {
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) return;
  if (!rateLimit(`reset:${email}`, 3, 60 * 60_000) || !rateLimit(`reset-ip:${ip}`, 20, 60 * 60_000)) return;
  const user = await db.user.findUnique({ where: { email }, include: { tenant: { select: { status: true, name: true } } } });
  if (!user || user.status !== "ACTIVE" || (user.tenant && user.tenant.status !== "ACTIVE")) return;

  const token = randomBytes(32).toString("base64url");
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha(token), expiresAt: new Date(now.getTime() + TTL_MS), requestIp: ip } });
  await db.auditEvent.create({
    data: { tenantId: user.tenantId, actorUserId: user.id, action: "user.password_reset_requested", entityType: "User", entityId: user.id, ip, createdAt: now },
  });
  await sendEmails([{
    tenantId: user.tenantId,
    to: user.email,
    subject: "Reset your WorkLog password",
    text: `Someone (hopefully you) asked to reset the WorkLog password for ${user.email}.\n\nSet a new password here (the link works once, for 30 minutes):\n${appUrl(`/reset-password?token=${token}`)}\n\nIf you didn't ask for this, ignore this email; your password stays the same.`,
  }]);
}

export async function resetPasswordWithToken(token: string, next: string, ip: string | null, now = new Date()) {
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha(token) } });
  if (!row || row.usedAt || row.expiresAt < now) throw new AppError("RESET_LINK_INVALID");
  const problem = passwordProblem(next);
  if (problem) throw new AppError(`PASSWORD_${problem}`);
  const user = await db.user.findUniqueOrThrow({ where: { id: row.userId } });
  if (user.status !== "ACTIVE") throw new AppError("RESET_LINK_INVALID");

  await db.$transaction([
    // Claim the token atomically so it can't be used twice in parallel.
    db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next), mustChangePassword: false, authVersion: { increment: 1 } },
    }),
    db.auditEvent.create({
      data: { tenantId: user.tenantId, actorUserId: user.id, action: "user.password_reset_completed", entityType: "User", entityId: user.id, ip, createdAt: now },
    }),
  ]);
  await sendEmails([{
    tenantId: user.tenantId,
    to: user.email,
    subject: "Your WorkLog password was changed",
    text: `The password for ${user.email} was just changed, and you were signed out everywhere else.\n\nIf this wasn't you, contact your administrator straight away.`,
  }]);
  return { email: user.email };
}
