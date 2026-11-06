import "server-only";
import { prismaUnscoped as db } from "../db/client";
import { AppError } from "../errors";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

/** Self-service password change (identity-level, so it uses the unscoped client by user id). */
export async function changeOwnPassword(userId: string, current: string, next: string, ip: string | null) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current))) throw new AppError("WRONG_PASSWORD");
  const problem = passwordProblem(next);
  if (problem) throw new AppError(`PASSWORD_${problem}`);
  if (current === next) throw new AppError("PASSWORD_SAME");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  await db.auditEvent.create({
    data: { tenantId: user.tenantId, actorUserId: userId, action: "user.password_changed", entityType: "User", entityId: userId, ip },
  });
}
