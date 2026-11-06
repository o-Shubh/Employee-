import type { Prisma } from "@prisma/client";
import type { TenantClient } from "../db/tenant";
import type { TenantCtx } from "../context";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  subjectEmployeeId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string | null;
  ip?: string | null;
  /** Event time; defaults to now. Services pass the request time so entry and audit timestamps agree. */
  at?: Date;
}

/** Append an audit event (the table rejects UPDATE/DELETE). */
export async function audit(ctx: TenantCtx, e: AuditInput, db: TenantClient = ctx.db) {
  await db.auditEvent.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.actor.userId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      subjectEmployeeId: e.subjectEmployeeId ?? null,
      before: e.before,
      after: e.after,
      reason: e.reason ?? null,
      ip: e.ip ?? null,
      createdAt: e.at,
    },
  });
}

export async function listAuditForEmployee(
  ctx: TenantCtx,
  employeeId: string,
  opts: { from?: Date; to?: Date; take?: number } = {},
) {
  return ctx.db.auditEvent.findMany({
    where: {
      subjectEmployeeId: employeeId,
      createdAt: { gte: opts.from, lt: opts.to },
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 200,
  });
}
