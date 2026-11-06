import { dateKeyToDb, localDateKey } from "@/domain/time";
import { prismaUnscoped as db } from "../db/client";
import { forTenant } from "../db/tenant";
import { staleShiftMs } from "../context";
import { recomputeDay } from "../services/attendance";
import type { TenantCtx } from "../context";
import { retryEmails, sendEmails } from "../mail";
import { activeDelegatesOf } from "../services/approval-rights";
import { adminUserIds, notify } from "../services/notifications";

/**
 * Escalation: pending requests that have waited longer than the tenant's
 * `escalationDays`, or whose approver is on approved leave today with nobody
 * covering, are flagged (escalatedAt) and every company admin is notified once.
 */
export async function escalateTenant(tenantId: string, now: Date) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const scoped = forTenant(tenantId, db);
  const ctx: TenantCtx = { tenantId, tenant, db: scoped, actor: { userId: "system", role: "COMPANY_ADMIN", employeeId: null } };
  const today = localDateKey(now, tenant.timezone);
  const cutoff = new Date(now.getTime() - tenant.escalationDays * 86400_000);

  const away = await scoped.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: { lte: dateKeyToDb(today) }, endDate: { gte: dateKeyToDb(today) }, employee: { user: { role: "MANAGER" } } },
    select: { employeeId: true },
  });
  const uncovered: string[] = [];
  for (const a of away) if ((await activeDelegatesOf(ctx, a.employeeId, scoped, now)).length === 0) uncovered.push(a.employeeId);

  const where = {
    status: "PENDING" as const,
    escalatedAt: null,
    OR: [{ createdAt: { lt: cutoff } }, ...(uncovered.length ? [{ employee: { managerId: { in: uncovered } } }] : [])],
  };
  const data = { escalatedAt: now };
  const [a, b, c] = await Promise.all([
    scoped.leaveRequest.updateMany({ where, data }),
    scoped.correctionRequest.updateMany({ where, data }),
    scoped.overtimeRequest.updateMany({ where, data }),
  ]);
  const count = a.count + b.count + c.count;
  if (count > 0) {
    const mail = await notify(ctx, scoped, await adminUserIds(scoped), "requests.escalated", { count, days: tenant.escalationDays }, "/approvals");
    await sendEmails(mail);
    await scoped.auditEvent.create({
      data: { tenantId, actorUserId: null, action: "requests.escalated", entityType: "Request", after: { count, olderThanDays: tenant.escalationDays, approversOnLeave: uncovered.length }, createdAt: now },
    });
  }
  return count;
}

/** Days still marked OPEN long after check-in were never checked out: recompute them (→ MISSED_CHECKOUT). */
export async function refreshStaleDays(tenantId: string, now: Date) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const scoped = forTenant(tenantId, db);
  const ctx: TenantCtx = { tenantId, tenant, db: scoped, actor: { userId: "system", role: "COMPANY_ADMIN", employeeId: null } };
  const stale = await scoped.dayRecord.findMany({
    where: { state: "OPEN", firstInAt: { lt: new Date(now.getTime() - staleShiftMs()) } },
    select: { employeeId: true, workDate: true },
    take: 500,
  });
  for (const r of stale) await recomputeDay(ctx, r.employeeId, r.workDate.toISOString().slice(0, 10), now);
  return stale.length;
}

/** One pass over every active tenant. Safe to run concurrently (advisory lock) and repeatedly. */
export async function runSweep(now = new Date()) {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('worklog:sweep')) AS locked`;
      if (!rows[0]?.locked) return { skipped: true as const };
      const tenants = await db.tenant.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
      let escalated = 0;
      let daysRefreshed = 0;
      for (const t of tenants) {
        daysRefreshed += await refreshStaleDays(t.id, now);
        escalated += await escalateTenant(t.id, now);
      }
      const emailsRetried = await retryEmails();
      return { skipped: false as const, tenants: tenants.length, escalated, daysRefreshed, emailsRetried };
    },
    { timeout: 10 * 60_000, maxWait: 5_000 },
  );
}

