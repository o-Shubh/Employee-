import type { RequestEnv, TenantCtx } from "../context";
import { audit } from "./audit";

/** Bump when the privacy notice text (messages: consent.*) materially changes. */
export const CURRENT_NOTICE_VERSION = "2026-11-v1";

export async function hasCurrentConsent(ctx: TenantCtx): Promise<boolean> {
  const c = await ctx.db.consentRecord.findFirst({
    where: { userId: ctx.actor.userId, noticeVersion: CURRENT_NOTICE_VERSION },
    select: { id: true },
  });
  return !!c;
}

export async function recordConsent(ctx: TenantCtx, env: RequestEnv) {
  if (await hasCurrentConsent(ctx)) return;
  const rec = await ctx.db.consentRecord.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.actor.userId,
      noticeVersion: CURRENT_NOTICE_VERSION,
      acceptedAt: env.now,
      ip: env.ip,
      userAgent: env.userAgent?.slice(0, 300) ?? null,
    },
  });
  await audit(ctx, {
    action: "consent.accepted", entityType: "ConsentRecord", entityId: rec.id,
    subjectEmployeeId: ctx.actor.employeeId, ip: env.ip, at: env.now, after: { noticeVersion: CURRENT_NOTICE_VERSION },
  });
}

export async function listMyConsents(ctx: TenantCtx) {
  return ctx.db.consentRecord.findMany({ where: { userId: ctx.actor.userId }, orderBy: { acceptedAt: "desc" } });
}
