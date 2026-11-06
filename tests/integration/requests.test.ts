import { beforeEach, describe, expect, it } from "vitest";
import { forTenant } from "@/server/db/tenant";
import { AppError } from "@/server/errors";
import { allocateYear, applyLeave, cancelLeave, decideLeave, getBalances, adjustBalance } from "@/server/services/leave";
import { decideCorrection, requestCorrection, cancelCorrection } from "@/server/services/corrections";
import { decideOvertime, requestOvertime } from "@/server/services/overtime";
import { certifyDay, getDayDetail, punch } from "@/server/services/attendance";
import { db, makeTenant, officeEnv } from "./fixtures";

const H = 3600_000;
const NOW = new Date("2026-11-04T06:30:00Z"); // Wed 4 Nov 2026, 12:00 IST
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

async function withLeaveTypes() {
  const T = await makeTenant("lv");
  const cl = await db.leaveType.create({ data: { tenantId: T.tenant.id, code: "CL", name: "Casual leave", yearlyQuota: 8 } });
  const lwp = await db.leaveType.create({ data: { tenantId: T.tenant.id, code: "LWP", name: "Leave without pay", tracksBalance: false, paid: false } });
  await allocateYear(T.ctx.admin, 2026, env());
  return { ...T, cl, lwp };
}

describe("leave", () => {
  let T: Awaited<ReturnType<typeof withLeaveTypes>>;
  beforeEach(async () => {
    T = await withLeaveTypes();
  });

  it("allocation is idempotent and builds the balance from the ledger", async () => {
    expect((await allocateYear(T.ctx.admin, 2026, env())).created).toBe(0);
    const [cl] = await getBalances(T.ctx.employee, T.employee.employee.id, 2026);
    expect(cl).toMatchObject({ balance: 8, pending: 0, available: 8 });
  });

  it("apply → pending reserves days → approve debits → cancel future leave reverses", async () => {
    // Mon 9 – Wed 11 Nov = 3 working days, last one a half day → 2.5
    const req = await applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-09", endDate: "2026-11-11", halfDayEnd: true, reason: "Family function" }, env());
    expect(Number(req.days)).toBe(2.5);
    let [b] = await getBalances(T.ctx.employee, T.employee.employee.id, 2026);
    expect(b).toMatchObject({ balance: 8, pending: 2.5, available: 5.5 });

    await decideLeave(T.ctx.manager, req.id, { decision: "APPROVE", comment: "Enjoy" }, env());
    [b] = await getBalances(T.ctx.employee, T.employee.employee.id, 2026);
    expect(b).toMatchObject({ balance: 5.5, pending: 0, used: 2.5 });

    await cancelLeave(T.ctx.employee, req.id, {}, env());
    [b] = await getBalances(T.ctx.employee, T.employee.employee.id, 2026);
    expect(b).toMatchObject({ balance: 8, used: 0 });
    const kinds = (await db.leaveLedger.findMany({ where: { leaveRequestId: req.id }, orderBy: { createdAt: "asc" } })).map((l) => [l.kind, Number(l.days)]);
    expect(kinds).toEqual([["DEBIT", -2.5], ["REVERSAL", 2.5]]);
  });

  it("weekends are free; insufficient balance, overlap and invalid spans are rejected", async () => {
    // Fri 6 – Mon 9 = 2 working days
    const r = await applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-06", endDate: "2026-11-09", reason: "Trip home" }, env());
    expect(Number(r.days)).toBe(2);
    expect(await code(applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-09", endDate: "2026-11-09", reason: "Again" }, env()))).toBe("LEAVE_OVERLAP");
    expect(await code(applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-16", endDate: "2026-11-27", reason: "Long trip" }, env()))).toBe("INSUFFICIENT_BALANCE");
    expect(await code(applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-07", endDate: "2026-11-08", reason: "Weekend" }, env()))).toBe("LEAVE_NO_WORKING_DAYS");
    // unpaid leave has no balance to run out of
    expect(await code(applyLeave(T.ctx.employee, { leaveTypeId: T.lwp.id, startDate: "2026-11-16", endDate: "2026-11-27", reason: "Long trip" }, env()))).toBe("OK");
  });

  it("approval rights: direct manager or admin, never yourself; rejections need a comment", async () => {
    const req = await applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-12", endDate: "2026-11-12", reason: "Doctor" }, env());
    expect(await code(decideLeave(T.ctx.employee, req.id, { decision: "APPROVE" }, env()))).toBe("CANNOT_APPROVE_OWN");
    expect(await code(decideLeave(T.ctx.other, req.id, { decision: "APPROVE" }, env()))).toBe("FORBIDDEN");
    expect(await code(decideLeave(T.ctx.manager, req.id, { decision: "REJECT" }, env()))).toBe("COMMENT_REQUIRED");
    expect(await code(decideLeave(T.ctx.admin, req.id, { decision: "REJECT", comment: "Audit week" }, env()))).toBe("OK");
    expect(await code(decideLeave(T.ctx.manager, req.id, { decision: "APPROVE" }, env()))).toBe("ALREADY_DECIDED");

    // A manager of another team can't decide; the manager's own leave goes to the admin.
    const mine = await applyLeave(T.ctx.manager, { leaveTypeId: T.cl.id, startDate: "2026-11-13", endDate: "2026-11-13", reason: "Personal" }, env());
    expect(await code(decideLeave(T.ctx.manager, mine.id, { decision: "APPROVE" }, env()))).toBe("CANNOT_APPROVE_OWN");
    expect(await code(decideLeave(T.ctx.admin, mine.id, { decision: "APPROVE" }, env()))).toBe("OK");
  });

  it("employees can't cancel approved leave that has started; admins can (with a reason)", async () => {
    const req = await applyLeave(T.ctx.employee, { leaveTypeId: T.cl.id, startDate: "2026-11-02", endDate: "2026-11-05", reason: "Fever" }, env());
    await decideLeave(T.ctx.manager, req.id, { decision: "APPROVE" }, env());
    expect(await code(cancelLeave(T.ctx.employee, req.id, {}, env()))).toBe("LEAVE_ALREADY_STARTED");
    expect(await code(cancelLeave(T.ctx.admin, req.id, {}, env()))).toBe("COMMENT_REQUIRED");
    expect(await code(cancelLeave(T.ctx.admin, req.id, { comment: "Came to office" }, env()))).toBe("OK");
  });

  it("the ledger is append-only", async () => {
    await adjustBalance(T.ctx.admin, { employeeId: T.employee.employee.id, leaveTypeId: T.cl.id, year: 2026, days: 1.5, reason: "Comp-off for Diwali duty" }, env());
    const row = await db.leaveLedger.findFirstOrThrow({ where: { tenantId: T.tenant.id, kind: "ADJUSTMENT" } });
    await expect(db.leaveLedger.update({ where: { id: row.id }, data: { days: 100 } })).rejects.toThrow(/WORKLOG_APPEND_ONLY/);
    await expect(db.leaveLedger.delete({ where: { id: row.id } })).rejects.toThrow(/WORKLOG_APPEND_ONLY/);
  });
});

describe("corrections", () => {
  // Mon 2 Nov 2026, 09:00 IST
  const D = "2026-11-02";
  const T0 = new Date("2026-11-02T03:30:00Z");
  const at = (h: number) => new Date(T0.getTime() + h * H);

  it("missed check-out: request → approve adds a CORRECTION entry, originals untouched, day closes", async () => {
    const T = await makeTenant("cor");
    const ctx = T.ctx.employee;
    await punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken));
    await punch(ctx, { type: "BREAK", breakKind: "LUNCH" }, officeEnv(at(4), T.deviceToken));
    await punch(ctx, { type: "ON_DUTY" }, officeEnv(at(5), T.deviceToken));
    const before = await db.logEntry.findMany({ where: { tenantId: T.tenant.id } });

    const req = await requestCorrection(ctx, { workDate: D, reason: "Forgot to check out, left at 18:00", ops: [{ op: "ADD", type: "CHECK_OUT", occurredAt: at(9).toISOString() }] }, env());
    expect(await code(requestCorrection(ctx, { workDate: D, reason: "Again please", ops: [{ op: "ADD", type: "CHECK_OUT", occurredAt: at(9).toISOString() }] }, env()))).toBe("CORRECTION_ALREADY_PENDING");
    expect(await code(decideCorrection(T.ctx.other, req.id, { decision: "APPROVE" }, env()))).toBe("FORBIDDEN");
    await decideCorrection(T.ctx.manager, req.id, { decision: "APPROVE", comment: "Confirmed with security log" }, env());

    const after = await db.logEntry.findMany({ where: { tenantId: T.tenant.id } });
    expect(after).toHaveLength(before.length + 1);
    for (const b of before) expect(after.find((a) => a.id === b.id)).toEqual(b); // byte-for-byte unchanged
    const added = after.find((a) => !before.some((b) => b.id === a.id))!;
    expect(added).toMatchObject({ type: "CHECK_OUT", source: "CORRECTION", correctionRequestId: req.id, createdById: T.manager.user.id });

    const rec = await db.dayRecord.findFirstOrThrow({ where: { tenantId: T.tenant.id } });
    expect(rec).toMatchObject({ state: "CLOSED", workMin: 8 * 60, breakMin: 60 });
    const stored = await db.correctionRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(stored.appliedEntryIds).toEqual([added.id]);
  });

  it("wrong time: supersedes the original, invalidates the certification", async () => {
    const T = await makeTenant("cor2");
    const ctx = T.ctx.employee;
    const { entryId } = await punch(ctx, { type: "CHECK_IN" }, officeEnv(at(1), T.deviceToken));
    await punch(ctx, { type: "CHECK_OUT" }, officeEnv(at(9), T.deviceToken));
    await certifyDay(ctx, { workDate: D, summary: "Audit prep", certify: true }, officeEnv(at(9.1), T.deviceToken));

    const req = await requestCorrection(ctx, { workDate: D, reason: "Biometric queue; actually arrived at 09:00", ops: [{ op: "CHANGE_TIME", entryId, occurredAt: at(0).toISOString() }] }, env());
    await decideCorrection(T.ctx.admin, req.id, { decision: "APPROVE" }, env());

    const detail = await getDayDetail(ctx, ctx.actor.employeeId!, D, NOW);
    expect(detail.computation.workSeconds).toBe(9 * 3600);
    expect(detail.entries.find((e) => e.id === entryId)?.superseded).toBe(true);
    expect(detail.isCertified).toBe(false);
    const rec = await db.dayRecord.findFirstOrThrow({ where: { tenantId: T.tenant.id } });
    expect(rec.flags).toContain("RECERTIFY_REQUIRED");
  });

  it("requests that would produce an invalid day are refused; approval re-validates", async () => {
    const T = await makeTenant("cor3");
    const ctx = T.ctx.employee;
    const { entryId } = await punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken));
    expect(entryId).toBeTruthy();
    // ON_DUTY right after CHECK_IN is not a valid sequence
    expect(await code(requestCorrection(ctx, { workDate: D, reason: "Back from somewhere", ops: [
      { op: "ADD", type: "ON_DUTY", occurredAt: at(1).toISOString() },
      { op: "ADD", type: "CHECK_OUT", occurredAt: at(9).toISOString() },
    ] }, env()))).toBe("CORRECTION_RESULT_INVALID_SEQUENCE");
    expect(await code(requestCorrection(ctx, { workDate: "2026-11-30", reason: "Future day", ops: [{ op: "ADD", type: "CHECK_IN", occurredAt: at(0).toISOString() }] }, env()))).toBe("CORRECTION_FUTURE_DAY");
    const req = await requestCorrection(ctx, { workDate: D, reason: "Left at 18:00", ops: [{ op: "ADD", type: "CHECK_OUT", occurredAt: at(9).toISOString() }] }, env());
    await cancelCorrection(ctx, req.id, env());
    expect(await code(decideCorrection(T.ctx.manager, req.id, { decision: "APPROVE" }, env()))).toBe("ALREADY_DECIDED");
  });
});

describe("overtime", () => {
  it("request and decide; duplicates are refused", async () => {
    const T = await makeTenant("ot");
    const r = await requestOvertime(T.ctx.employee, { workDate: "2026-11-03", minutes: 90, reason: "Quarter close" }, env());
    expect(await code(requestOvertime(T.ctx.employee, { workDate: "2026-11-03", minutes: 30, reason: "More hours" }, env()))).toBe("OVERTIME_ALREADY_REQUESTED");
    expect(await code(decideOvertime(T.ctx.employee, r.id, { decision: "APPROVE" }, env()))).toBe("CANNOT_APPROVE_OWN");
    expect(await code(decideOvertime(T.ctx.manager, r.id, { decision: "APPROVE" }, env()))).toBe("OK");
    expect(await code(decideOvertime(T.ctx.admin, r.id, { decision: "REJECT", comment: "x" }, env()))).toBe("ALREADY_DECIDED");
  });
});

describe("phase 2 tenant isolation", () => {
  it("a manager or admin of another tenant cannot see or decide requests", async () => {
    const A = await withLeaveTypes();
    const B = await makeTenant("iso2");
    const req = await applyLeave(A.ctx.employee, { leaveTypeId: A.cl.id, startDate: "2026-11-12", endDate: "2026-11-12", reason: "Doctor" }, env());
    const ot = await requestOvertime(A.ctx.employee, { workDate: "2026-11-03", minutes: 60, reason: "Release night" }, env());
    expect(await code(decideLeave(B.ctx.admin, req.id, { decision: "APPROVE" }, env()))).toBe("NOT_FOUND");
    expect(await code(decideOvertime(B.ctx.admin, ot.id, { decision: "APPROVE" }, env()))).toBe("NOT_FOUND");
    const b = forTenant(B.tenant.id, db);
    expect(await b.leaveRequest.count()).toBe(0);
    expect(await b.leaveLedger.count()).toBe(0);
    expect(await b.leaveType.findMany()).toEqual([]);
    // DB-level: a request in B pointing at A's leave type is rejected
    await expect(
      db.leaveRequest.create({
        data: { tenantId: B.tenant.id, employeeId: B.employee.employee.id, leaveTypeId: A.cl.id, startDate: new Date("2026-11-12"), endDate: new Date("2026-11-12"), days: 1, reason: "x" },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });
});
