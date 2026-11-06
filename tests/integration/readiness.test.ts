import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { forTenant } from "@/server/db/tenant";
import { AppError } from "@/server/errors";
import type { TenantCtx } from "@/server/context";
import { allocateYear, applyLeave, decideLeave } from "@/server/services/leave";
import { requestOvertime, decideOvertime } from "@/server/services/overtime";
import { createDelegation, revokeDelegation } from "@/server/services/delegations";
import { pendingLeaveForApprover } from "@/server/services/leave";
import { escalateTenant } from "@/server/jobs/sweep";
import { requestPasswordReset, resetPasswordWithToken } from "@/server/auth/password-reset";
import { getShiftState, punch } from "@/server/services/attendance";
import { teamBoard } from "@/server/services/team";
import { db, HOME_IP, makeTenant, officeEnv } from "./fixtures";

const NOW = new Date("2026-11-04T06:30:00Z"); // Wed 4 Nov 2026 12:00 IST
const env = (now = NOW) => officeEnv(now, null);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

async function setup() {
  const T = await makeTenant("rd");
  const cl = await db.leaveType.create({ data: { tenantId: T.tenant.id, code: "CL", name: "Casual leave", yearlyQuota: 8 } });
  await allocateYear(T.ctx.admin, 2026, env());
  // a second manager to cover approvals
  const u = await db.user.create({ data: { tenantId: T.tenant.id, email: `mgr2-${T.tenant.id}@example.test`, passwordHash: "x", role: "MANAGER", mustChangePassword: false } });
  const m2 = await db.employee.create({ data: { tenantId: T.tenant.id, userId: u.id, employeeCode: "MGR2", fullName: "Second Manager" } });
  const m2ctx: TenantCtx = { ...T.ctx.manager, actor: { userId: u.id, role: "MANAGER", employeeId: m2.id } };
  return { ...T, cl, m2, m2ctx };
}

describe("notifications", () => {
  it("a request notifies the approver; the decision notifies the requester; nobody is notified of their own action", async () => {
    const T = await setup();
    const req = await applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-12", endDate: "2026-11-12", reason: "Doctor visit" }, env());
    const toManager = await db.notification.findMany({ where: { tenantId: T.tenant.id, userId: T.manager.user.id } });
    expect(toManager.map((n) => n.kind)).toEqual(["leave.requested"]);
    expect(await db.notification.count({ where: { tenantId: T.tenant.id, userId: T.employee.user.id } })).toBe(0);
    expect(await db.emailMessage.count({ where: { tenantId: T.tenant.id, toEmail: T.manager.user.email, status: "SENT" } })).toBe(1);

    await decideLeave(T.ctx.manager, req.id, { decision: "REJECT", comment: "Audit week" }, env());
    const toEmployee = await db.notification.findMany({ where: { tenantId: T.tenant.id, userId: T.employee.user.id } });
    expect(toEmployee.map((n) => n.kind)).toEqual(["leave.rejected"]);
    const mail = await db.emailMessage.findFirstOrThrow({ where: { tenantId: T.tenant.id, toEmail: T.employee.user.email } });
    expect(mail.text).toContain("Audit week");
  });

  it("email preference off: in-app only", async () => {
    const T = await setup();
    await db.user.update({ where: { id: T.manager.user.id }, data: { emailNotifications: false } });
    await requestOvertime(T.ctx.employee, { workDate: "2026-11-03", minutes: 60, reason: "Release night" }, env());
    expect(await db.notification.count({ where: { tenantId: T.tenant.id, userId: T.manager.user.id } })).toBe(1);
    expect(await db.emailMessage.count({ where: { tenantId: T.tenant.id, toEmail: T.manager.user.email } })).toBe(0);
  });

  it("someone with no manager: requests go to the company admins", async () => {
    const T = await setup();
    await requestOvertime(T.ctx.other, { workDate: "2026-11-03", minutes: 60, reason: "Release night" }, env());
    expect(await db.notification.count({ where: { tenantId: T.tenant.id, userId: T.admin.user.id, kind: "overtime.requested" } })).toBe(1);
  });
});

describe("approver delegation", () => {
  it("the covering manager can decide during the window, not after it's ended", async () => {
    const T = await setup();
    const today = "2026-11-04";
    // before cover: second manager can't decide
    const r1 = await requestOvertime(T.ctx.employee, { workDate: "2026-11-03", minutes: 60, reason: "Release night" }, env());
    expect(await code(decideOvertime(T.m2ctx, r1.id, { decision: "APPROVE" }, env()))).toBe("FORBIDDEN");

    const d = await createDelegation(T.ctx.manager, { toEmployeeId: T.m2.id, startDate: today, endDate: "2026-11-10" }, env());
    expect(await db.notification.count({ where: { userId: T.m2.userId, kind: "delegation.assigned" } })).toBe(1);
    // queue and decision both honour it (the real clock is used for "today", so pin the window around it)
    await db.approverDelegation.update({ where: { id: d.id }, data: { startDate: new Date("2000-01-01"), endDate: new Date("2100-01-01") } });
    expect((await pendingLeaveForApprover(T.m2ctx)).length).toBe(0);
    expect(await code(decideOvertime(T.m2ctx, r1.id, { decision: "APPROVE", comment: "Covering for MGR" }, env()))).toBe("OK");
    const ev = await db.auditEvent.findFirstOrThrow({ where: { tenantId: T.tenant.id, action: "overtime.approved" } });
    expect(ev.after).toMatchObject({ right: "DELEGATE" });

    // new request → notifies manager AND delegate
    await requestOvertime(T.ctx.employee, { workDate: "2026-11-02", minutes: 30, reason: "Vendor call" }, env());
    const recipients = await db.notification.findMany({ where: { tenantId: T.tenant.id, kind: "overtime.requested" }, select: { userId: true } });
    expect([...new Set(recipients.map((r) => r.userId))].sort()).toEqual([T.manager.user.id, T.m2.userId].sort());

    await revokeDelegation(T.ctx.manager, d.id, env());
    const r2 = await db.overtimeRequest.findFirstOrThrow({ where: { tenantId: T.tenant.id, status: "PENDING" } });
    expect(await code(decideOvertime(T.m2ctx, r2.id, { decision: "APPROVE" }, env()))).toBe("FORBIDDEN");
  });

  it("validation: only managers/admins can receive cover; managers set it only for themselves", async () => {
    const T = await setup();
    expect(await code(createDelegation(T.ctx.manager, { toEmployeeId: T.employee.employee.id, startDate: "2026-11-04", endDate: "2026-11-05" }, env()))).toBe("DELEGATE_ROLE_REQUIRED");
    expect(await code(createDelegation(T.m2ctx, { fromEmployeeId: T.manager.employee.id, toEmployeeId: T.m2.id, startDate: "2026-11-04", endDate: "2026-11-05" }, env()))).toBe("FORBIDDEN");
    expect(await code(createDelegation(T.ctx.employee, { toEmployeeId: T.m2.id, startDate: "2026-11-04", endDate: "2026-11-05" }, env()))).toBe("FORBIDDEN");
    expect(await code(createDelegation(T.ctx.admin, { fromEmployeeId: T.manager.employee.id, toEmployeeId: T.m2.id, startDate: "2026-11-04", endDate: "2026-11-05" }, env()))).toBe("OK");
    expect(await code(createDelegation(T.ctx.manager, { toEmployeeId: T.m2.id, startDate: "2026-11-05", endDate: "2026-11-06" }, env()))).toBe("DELEGATION_OVERLAP");
  });
});

describe("escalation", () => {
  it("old pending requests are escalated once and admins notified", async () => {
    const T = await setup();
    const r = await requestOvertime(T.ctx.employee, { workDate: "2026-11-03", minutes: 60, reason: "Release night" }, env());
    expect(await escalateTenant(T.tenant.id, new Date(NOW.getTime() + 86400_000))).toBe(0); // 1 day: not yet
    const later = new Date(NOW.getTime() + 4 * 86400_000);
    expect(await escalateTenant(T.tenant.id, later)).toBe(1);
    expect(await escalateTenant(T.tenant.id, later)).toBe(0); // idempotent
    expect((await db.overtimeRequest.findUniqueOrThrow({ where: { id: r.id } })).escalatedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: T.admin.user.id, kind: "requests.escalated" } })).toBe(1);
  });

  it("escalates immediately when the approver is on leave today and nobody is covering", async () => {
    const T = await setup();
    const now = new Date();
    const today = new Date(now.toISOString().slice(0, 10));
    await db.leaveRequest.create({
      data: { tenantId: T.tenant.id, employeeId: T.manager.employee.id, leaveTypeId: T.cl.id, startDate: new Date(today.getTime() - 86400_000), endDate: new Date(today.getTime() + 86400_000), days: 3, reason: "Away", status: "APPROVED", decidedById: T.admin.user.id, decidedAt: now },
    });
    await requestOvertime(T.ctx.employee, { workDate: now.toISOString().slice(0, 10), minutes: 60, reason: "Stock count" }, officeEnv(now, null));
    expect(await escalateTenant(T.tenant.id, now)).toBe(1);
  });
});

describe("password reset", () => {
  it("emails a single-use link; resetting bumps authVersion (signs out other sessions)", async () => {
    const T = await makeTenant("pw");
    const email = T.employee.user.email;
    await requestPasswordReset(email, "1.2.3.4");
    const mail = await db.emailMessage.findFirstOrThrow({ where: { toEmail: email, subject: { contains: "Reset" } } });
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    // only the hash is stored
    const row = await db.passwordResetToken.findFirstOrThrow({ where: { userId: T.employee.user.id } });
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(mail.text).not.toContain(row.tokenHash);

    expect(await code(resetPasswordWithToken(token, "short", null))).toBe("PASSWORD_TOO_SHORT");
    await resetPasswordWithToken(token, "NewPassw0rd2026", null);
    const u = await db.user.findUniqueOrThrow({ where: { id: T.employee.user.id } });
    expect(u.authVersion).toBe(1);
    expect(await code(resetPasswordWithToken(token, "AnotherPass2026", null))).toBe("RESET_LINK_INVALID");
  });

  it("unknown emails and expired links reveal nothing / fail", async () => {
    const before = await db.emailMessage.count();
    await requestPasswordReset("nobody-at-all@example.test", null);
    expect(await db.emailMessage.count()).toBe(before);
    const T = await makeTenant("pw2");
    await requestPasswordReset(T.employee.user.email, null, new Date(Date.now() - 3600_000)); // issued an hour ago → expired
    const mail = await db.emailMessage.findFirstOrThrow({ where: { toEmail: T.employee.user.email } });
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    expect(await code(resetPasswordWithToken(token, "NewPassw0rd2026", null))).toBe("RESET_LINK_INVALID");
  });
});

describe("field check-out from outside the office", () => {
  const T0 = new Date("2026-11-02T03:30:00Z");
  const at = (h: number) => new Date(T0.getTime() + h * 3600_000);

  it("is refused unless the company allows it, and only when ending field duty; allowed entries are flagged", async () => {
    const T = await makeTenant("fld");
    const ctx = T.ctx.employee;
    await punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken));
    await punch(ctx, { type: "FIELD_DUTY", note: "Site visit" }, officeEnv(at(2), T.deviceToken));
    const outside = { now: at(7), ip: HOME_IP, deviceToken: null };
    expect(await code(punch(ctx, { type: "CHECK_OUT" }, outside))).toBe("IP_NOT_ALLOWED");

    const allowed = { ...ctx, tenant: { ...ctx.tenant, allowFieldCheckoutAnywhere: true } };
    expect(await code(punch(allowed, { type: "ON_DUTY" }, outside))).toBe("IP_NOT_ALLOWED"); // only check-out
    expect(await code(punch(allowed, { type: "CHECK_OUT" }, outside))).toBe("OK");
    const out = await db.logEntry.findFirstOrThrow({ where: { tenantId: T.tenant.id, type: "CHECK_OUT" } });
    expect(out).toMatchObject({ offsite: true, ip: HOME_IP, deviceId: null });
    const rec = await db.dayRecord.findFirstOrThrow({ where: { tenantId: T.tenant.id } });
    expect(rec.flags).toContain("OFFSITE_CHECKOUT");
    expect(rec.workMin).toBe(7 * 60);
  });

  it("an ON_DUTY employee can't use it to check out from home", async () => {
    const T = await makeTenant("fld2");
    const allowed = { ...T.ctx.employee, tenant: { ...T.tenant, allowFieldCheckoutAnywhere: true } };
    await punch(allowed, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken));
    expect(await code(punch(allowed, { type: "CHECK_OUT" }, { now: at(8), ip: HOME_IP }))).toBe("IP_NOT_ALLOWED");
  });
});

describe("team board", () => {
  it("matches per-employee shift state, with a fixed number of queries", async () => {
    const T = await makeTenant("brd");
    const now = new Date();
    const e = (h: number) => officeEnv(new Date(now.getTime() - h * 3600_000), T.deviceToken);
    await punch(T.ctx.employee, { type: "CHECK_IN" }, e(3));
    await punch(T.ctx.employee, { type: "BREAK", breakKind: "TEA" }, e(1));
    const board = await teamBoard(T.ctx.admin, now);
    expect(board).toHaveLength(4);
    for (const row of board) {
      const s = await getShiftState(T.ctx.admin, row.person.id, now);
      expect(row.shift.status).toBe(s.status);
      expect(row.shift.computation.workSeconds).toBe(s.computation.workSeconds);
      expect(row.shift.computation.breakSeconds).toBe(s.computation.breakSeconds);
    }
    expect(board.find((r) => r.person.id === T.employee.employee.id)?.board).toBe("BREAK");
  });
});

describe("readiness: tenant isolation", () => {
  it("notifications and delegations never cross tenants", async () => {
    const A = await setup();
    const B = await setup();
    await requestOvertime(A.ctx.employee, { workDate: "2026-11-03", minutes: 60, reason: "Release night" }, env());
    expect(await forTenant(B.tenant.id, db).notification.count()).toBe(0);
    expect(await code(createDelegation(A.ctx.manager, { toEmployeeId: B.m2.id, startDate: "2026-11-04", endDate: "2026-11-05" }, env()))).toBe("NOT_FOUND");
    await expect(
      db.approverDelegation.create({
        data: { tenantId: A.tenant.id, fromEmployeeId: A.manager.employee.id, toEmployeeId: B.m2.id, startDate: new Date("2026-11-04"), endDate: new Date("2026-11-05"), createdById: A.admin.user.id },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });
});
