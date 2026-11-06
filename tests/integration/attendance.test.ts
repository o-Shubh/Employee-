import { beforeEach, describe, expect, it } from "vitest";
import { certifyDay, getDayDetail, getShiftState, punch, recordIdleBreak } from "@/server/services/attendance";
import { decideDevice, requestDeviceRegistration } from "@/server/services/devices";
import { AppError } from "@/server/errors";
import { db, HOME_IP, makeTenant, officeEnv } from "./fixtures";

const H = 3600_000;
// 2026-03-02 09:00 IST
const T0 = new Date("2026-03-02T03:30:00Z");
const at = (h: number) => new Date(T0.getTime() + h * H);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

describe("check-in gate: office IP + registered device", () => {
  let T: Awaited<ReturnType<typeof makeTenant>>;
  beforeEach(async () => {
    T = await makeTenant("gate");
  });

  it("denies check-in from outside the office network and audits it", async () => {
    const r = await code(punch(T.ctx.employee, { type: "CHECK_IN" }, { now: at(0), ip: HOME_IP, deviceToken: T.deviceToken }));
    expect(r).toBe("IP_NOT_ALLOWED");
    const ev = await db.auditEvent.findFirst({ where: { tenantId: T.tenant.id, action: "attendance.denied" } });
    expect(ev).toMatchObject({ reason: "IP_NOT_ALLOWED", ip: HOME_IP, subjectEmployeeId: T.employee.employee.id });
    expect(await db.logEntry.count({ where: { tenantId: T.tenant.id } })).toBe(0);
  });

  it("denies without a device token, with someone else's token, and with a pending device", async () => {
    expect(await code(punch(T.ctx.employee, { type: "CHECK_IN" }, officeEnv(at(0), null)))).toBe("DEVICE_NOT_REGISTERED");
    // the other employee presents the first employee's device cookie
    expect(await code(punch(T.ctx.other, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken)))).toBe("DEVICE_NOT_REGISTERED");

    const { token, deviceId } = await requestDeviceRegistration(T.ctx.other, { label: "Laptop" }, officeEnv(at(0), null));
    expect(await code(punch(T.ctx.other, { type: "CHECK_IN" }, officeEnv(at(0), token)))).toBe("DEVICE_PENDING");

    await decideDevice(T.ctx.admin, { deviceId, decision: "APPROVE" }, officeEnv(at(0), null));
    expect(await code(punch(T.ctx.other, { type: "CHECK_IN" }, officeEnv(at(0.1), token)))).toBe("OK");

    await decideDevice(T.ctx.admin, { deviceId, decision: "REVOKE", note: "Laptop returned" }, officeEnv(at(1), null));
    expect(await code(punch(T.ctx.other, { type: "BREAK", breakKind: "TEA" }, officeEnv(at(1.1), token)))).toBe("DEVICE_REVOKED");
  });

  it("only admins can approve devices; device registration requires office network", async () => {
    expect(await code(requestDeviceRegistration(T.ctx.other, { label: "Home PC" }, { now: at(0), ip: HOME_IP }))).toBe("IP_NOT_ALLOWED");
    const { deviceId } = await requestDeviceRegistration(T.ctx.other, { label: "PC" }, officeEnv(at(0), null));
    expect(await code(decideDevice(T.ctx.manager, { deviceId, decision: "APPROVE" }, officeEnv(at(0), null)))).toBe("FORBIDDEN");
    expect(await code(decideDevice(T.ctx.other, { deviceId, decision: "APPROVE" }, officeEnv(at(0), null)))).toBe("FORBIDDEN");
  });

  it("an employee assigned to a location is checked against that location only", async () => {
    const branch = await db.officeLocation.create({ data: { tenantId: T.tenant.id, name: "Branch", cidrs: ["192.168.50.0/24"] } });
    await db.employee.update({ where: { id: T.employee.employee.id }, data: { officeLocationId: branch.id } });
    expect(await code(punch(T.ctx.employee, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken)))).toBe("IP_NOT_ALLOWED");
    expect(await code(punch(T.ctx.employee, { type: "CHECK_IN" }, { now: at(0), ip: "192.168.50.9", deviceToken: T.deviceToken }))).toBe("OK");
  });
});

describe("a working day end to end", () => {
  it("check in → tea → duty → field → lunch → duty → check out → certify", async () => {
    const T = await makeTenant("day");
    const ctx = T.ctx.employee;
    const env = (h: number) => officeEnv(at(h), T.deviceToken);

    await punch(ctx, { type: "CHECK_IN" }, env(0));
    await punch(ctx, { type: "BREAK", breakKind: "TEA" }, env(1.5));
    await punch(ctx, { type: "ON_DUTY" }, env(1.75));
    expect(await code(punch(ctx, { type: "FIELD_DUTY" }, env(2)))).toBe("VALIDATION"); // note required
    await punch(ctx, { type: "FIELD_DUTY", note: "Client site visit" }, env(2));
    await punch(ctx, { type: "BREAK", breakKind: "LUNCH" }, env(4));
    await punch(ctx, { type: "ON_DUTY" }, env(4.5));
    expect(await code(punch(ctx, { type: "CHECK_IN" }, env(5)))).toBe("ALREADY_CHECKED_IN");
    expect(await code(certifyDay(ctx, { workDate: "2026-03-02", summary: "Worked", certify: true }, env(6)))).toBe("CERTIFY_NOT_CHECKED_OUT");
    await punch(ctx, { type: "CHECK_OUT" }, env(9));

    const state = await getShiftState(ctx, ctx.actor.employeeId!, at(9.5));
    expect(state.status).toBe("OFF");
    expect(state.computation.workSeconds).toBe(8.25 * 3600);
    expect(state.computation.breakSeconds).toBe(0.75 * 3600);
    expect(state.computation.fieldSeconds).toBe(2 * 3600);

    const rec = await db.dayRecord.findFirstOrThrow({ where: { tenantId: T.tenant.id, employeeId: ctx.actor.employeeId! } });
    expect(rec).toMatchObject({ state: "CLOSED", workMin: 495, breakMin: 45, fieldMin: 120 });

    await certifyDay(ctx, { workDate: "2026-03-02", summary: "Prepared Q1 report; client visit.", certify: true }, env(9.1));
    expect(await code(certifyDay(ctx, { workDate: "2026-03-02", summary: "again", certify: true }, env(9.2)))).toBe("ALREADY_CERTIFIED");
    const detail = await getDayDetail(ctx, ctx.actor.employeeId!, "2026-03-02", at(10));
    expect(detail.isCertified).toBe(true);
    expect(detail.entries).toHaveLength(7);
    expect(detail.auditEvents.map((a) => a.action)).toContain("day.certified");

    // Re-checking in the same day invalidates the certification (log changed).
    await punch(ctx, { type: "CHECK_IN" }, env(11));
    await punch(ctx, { type: "CHECK_OUT" }, env(12));
    const rec2 = await db.dayRecord.findFirstOrThrow({ where: { tenantId: T.tenant.id, employeeId: ctx.actor.employeeId! } });
    expect(rec2.state).toBe("CLOSED");
    expect(rec2.flags).toContain("RECERTIFY_REQUIRED");
    expect(rec2.workMin).toBe(495 + 60);
  });

  it("night shift: entries after midnight stay on the check-in date", async () => {
    const T = await makeTenant("night");
    const ctx = T.ctx.employee;
    const start = new Date("2026-03-02T16:30:00Z"); // 22:00 IST
    await punch(ctx, { type: "CHECK_IN" }, officeEnv(start, T.deviceToken));
    const r = await punch(ctx, { type: "CHECK_OUT" }, officeEnv(new Date(start.getTime() + 8 * H), T.deviceToken));
    expect(r.workDate).toBe("2026-03-02");
  });

  it("missed check-out: the next day starts fresh and the old day is flagged, never auto-closed", async () => {
    const T = await makeTenant("miss");
    const ctx = T.ctx.employee;
    await punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken));
    const next = at(24);
    const st = await getShiftState(ctx, ctx.actor.employeeId!, next);
    expect(st.status).toBe("OFF");
    expect(st.missedCheckoutOn).toBe("2026-03-02");
    const r = await punch(ctx, { type: "CHECK_IN" }, officeEnv(next, T.deviceToken));
    expect(r.workDate).toBe("2026-03-03");
    expect(await db.logEntry.count({ where: { tenantId: T.tenant.id, type: "CHECK_OUT" } })).toBe(0);
  });

  it("idle prompt 'yes' back-dates a break and resumes duty; it never fires on its own", async () => {
    const T = await makeTenant("idle");
    const ctx = T.ctx.employee;
    await punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken));
    expect(await code(recordIdleBreak(ctx, { idleSince: at(-1), breakKind: "PERSONAL" }, officeEnv(at(2), T.deviceToken)))).toBe("IDLE_BREAK_BEFORE_STATUS");
    await recordIdleBreak(ctx, { idleSince: at(1), breakKind: "PERSONAL" }, officeEnv(at(1.75), T.deviceToken));
    const st = await getShiftState(ctx, ctx.actor.employeeId!, at(2));
    expect(st.status).toBe("ON_DUTY");
    expect(st.computation.breakSeconds).toBe(0.75 * 3600);
    expect(st.computation.workSeconds).toBe(1.25 * 3600);
    const brk = await db.logEntry.findFirstOrThrow({ where: { tenantId: T.tenant.id, type: "BREAK" } });
    expect(brk.source).toBe("IDLE_PROMPT");
    expect(brk.recordedAt.getTime()).toBeGreaterThan(brk.occurredAt.getTime());
  });

  it("concurrent double-click produces exactly one check-in", async () => {
    const T = await makeTenant("race");
    const ctx = T.ctx.employee;
    const results = await Promise.allSettled([
      punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken)),
      punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken)),
      punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.logEntry.count({ where: { tenantId: T.tenant.id, type: "CHECK_IN" } })).toBe(1);
  });

  it("photo is required when the tenant enables it", async () => {
    const T = await makeTenant("photo");
    const ctx = { ...T.ctx.employee, tenant: { ...T.tenant, requirePhotoAtCheckIn: true } };
    expect(await code(punch(ctx, { type: "CHECK_IN" }, officeEnv(at(0), T.deviceToken)))).toBe("PHOTO_REQUIRED");
    expect(await code(punch(ctx, { type: "CHECK_IN", photo: "data:image/png;base64,AAAA" }, officeEnv(at(0), T.deviceToken)))).toBe("PHOTO_INVALID");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString("base64");
    expect(await code(punch(ctx, { type: "CHECK_IN", photo: `data:image/jpeg;base64,${jpeg}` }, officeEnv(at(0), T.deviceToken)))).toBe("OK");
    const e = await db.logEntry.findFirstOrThrow({ where: { tenantId: T.tenant.id } });
    expect(e.photoKey).toMatch(new RegExp(`^tenants/${T.tenant.id}/checkin/`));
  });
});
