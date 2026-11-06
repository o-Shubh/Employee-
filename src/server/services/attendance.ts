import { createHash, randomUUID } from "node:crypto";
import type { DayState, LogEntry } from "@prisma/client";
import { z } from "zod";
import { isIpAllowed } from "@/domain/cidr";
import { canTransition } from "@/domain/status-machine";
import { computeDay, effectiveEntries, toMinutes, type DayComputation } from "@/domain/timeline";
import { BREAK_KINDS, type WorkStatus } from "@/domain/types";
import { dateKeyToDb, dbToDateKey, localDateKey, type DateKey } from "@/domain/time";
import { AppError } from "../errors";
import { staleShiftMs, type RequestEnv, type TenantCtx } from "../context";
import type { TenantClient } from "../db/tenant";
import { hashDeviceToken } from "../security/device-token";
import { storage } from "../storage";
import { audit } from "./audit";

// ───────────────────────────── Inputs ─────────────────────────────

export const punchInput = z
  .object({
    type: z.enum(["CHECK_IN", "ON_DUTY", "BREAK", "FIELD_DUTY", "CHECK_OUT"]),
    breakKind: z.enum(BREAK_KINDS as [string, ...string[]]).optional(),
    note: z.string().trim().max(500).optional(),
    /** data:image/jpeg;base64,... — only when the tenant requires a check-in photo */
    photo: z.string().max(1_000_000).optional(),
  })
  .superRefine((v, c) => {
    if (v.type === "BREAK" && !v.breakKind) c.addIssue({ code: "custom", path: ["breakKind"], message: "BREAK_KIND_REQUIRED" });
    if (v.type !== "BREAK" && v.breakKind) c.addIssue({ code: "custom", path: ["breakKind"], message: "BREAK_KIND_NOT_ALLOWED" });
    if (v.type === "FIELD_DUTY" && !v.note) c.addIssue({ code: "custom", path: ["note"], message: "FIELD_NOTE_REQUIRED" });
  });
export type PunchInput = z.input<typeof punchInput>;

export const idleBreakInput = z.object({
  idleSince: z.coerce.date(),
  breakKind: z.enum(BREAK_KINDS as [string, ...string[]]),
});

export const certifyInput = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().trim().min(3).max(500),
  certify: z.literal(true),
});

// ───────────────────────────── Gate (IP + device) ─────────────────────────────

export type GateFailure = "NO_OFFICE_NETWORK" | "IP_NOT_ALLOWED" | "DEVICE_NOT_REGISTERED" | "DEVICE_PENDING" | "DEVICE_REVOKED";

export async function checkGate(
  ctx: TenantCtx,
  employeeId: string,
  env: Pick<RequestEnv, "ip" | "deviceToken">,
  opts: { requireDevice?: boolean } = {},
): Promise<{ ok: true; deviceId: string | null } | { ok: false; reason: GateFailure }> {
  const employee = await ctx.db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { officeLocationId: true },
  });
  const locations = await ctx.db.officeLocation.findMany({
    where: { active: true, ...(employee.officeLocationId ? { id: employee.officeLocationId } : {}) },
    select: { cidrs: true },
  });
  const cidrs = locations.flatMap((l) => l.cidrs);
  if (cidrs.length === 0) return { ok: false, reason: "NO_OFFICE_NETWORK" };
  if (!isIpAllowed(env.ip, cidrs)) return { ok: false, reason: "IP_NOT_ALLOWED" };
  if (opts.requireDevice === false) return { ok: true, deviceId: null };

  if (!env.deviceToken) return { ok: false, reason: "DEVICE_NOT_REGISTERED" };
  const device = await ctx.db.device.findFirst({
    where: { tokenHash: hashDeviceToken(env.deviceToken), employeeId },
    select: { id: true, status: true },
  });
  if (!device) return { ok: false, reason: "DEVICE_NOT_REGISTERED" };
  if (device.status === "PENDING") return { ok: false, reason: "DEVICE_PENDING" };
  if (device.status !== "APPROVED") return { ok: false, reason: "DEVICE_REVOKED" };
  return { ok: true, deviceId: device.id };
}

// ───────────────────────────── Reading state ─────────────────────────────

export interface ShiftState {
  /** The work date the next non-check-in punch would be written to (or today when off). */
  workDate: DateKey;
  todayKey: DateKey;
  status: WorkStatus;
  computation: DayComputation;
  entries: LogEntry[];
  /** An earlier day that was never checked out (needs a correction) */
  missedCheckoutOn: DateKey | null;
}

async function loadDayEntries(db: TenantClient, employeeId: string, workDate: DateKey) {
  return db.logEntry.findMany({
    where: { employeeId, workDate: dateKeyToDb(workDate) },
    orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
  });
}

export async function getShiftState(
  ctx: TenantCtx,
  employeeId: string,
  now: Date,
  db: TenantClient = ctx.db,
): Promise<ShiftState> {
  const tz = ctx.tenant.timezone;
  const todayKey = localDateKey(now, tz);
  const opts = { now, staleAfterMs: staleShiftMs() };
  const latest = await db.logEntry.findFirst({
    where: { employeeId },
    orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }],
    select: { workDate: true },
  });

  const empty = (missed: DateKey | null): ShiftState => ({
    workDate: todayKey, todayKey, status: "OFF", computation: computeDay([], opts), entries: [], missedCheckoutOn: missed,
  });
  if (!latest) return empty(null);

  const wk = dbToDateKey(latest.workDate);
  const entries = await loadDayEntries(db, employeeId, wk);
  const computation = computeDay(entries, opts);

  if (computation.status !== "OFF" || wk === todayKey) {
    return {
      workDate: wk, todayKey, status: computation.status, computation, entries,
      missedCheckoutOn: computation.missedCheckout ? wk : null,
    };
  }
  return empty(computation.missedCheckout ? wk : null);
}

// ───────────────────────────── Writing ─────────────────────────────

const MAX_PHOTO_BYTES = 600 * 1024;

function decodeJpeg(dataUrl: string): Uint8Array {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError("PHOTO_INVALID");
  const bytes = Buffer.from(m[1]!, "base64");
  if (bytes.length > MAX_PHOTO_BYTES) throw new AppError("PHOTO_TOO_LARGE");
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new AppError("PHOTO_INVALID");
  return new Uint8Array(bytes);
}

/** Serialise all punches of one employee so double clicks / two tabs can't race. */
async function lockEmployee(tx: TenantClient, tenantId: string, employeeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${employeeId}`}))`;
}

export async function punch(ctx: TenantCtx, raw: PunchInput, env: RequestEnv) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const parsed = punchInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", { issues: parsed.error.issues.map((i) => i.message) });
  const input = parsed.data;

  const gate = await checkGate(ctx, employeeId, env);
  if (!gate.ok) {
    await audit(ctx, {
      action: "attendance.denied",
      entityType: "LogEntry",
      subjectEmployeeId: employeeId,
      reason: gate.reason,
      ip: env.ip, at: env.now,
      after: { attempted: input.type },
    });
    throw new AppError(gate.reason);
  }

  let photoKey: string | null = null;
  if (input.type === "CHECK_IN" && ctx.tenant.requirePhotoAtCheckIn) {
    if (!input.photo) throw new AppError("PHOTO_REQUIRED");
    const bytes = decodeJpeg(input.photo);
    photoKey = `tenants/${ctx.tenantId}/checkin/${localDateKey(env.now, ctx.tenant.timezone)}/${employeeId}-${randomUUID()}.jpg`;
    await storage().put(photoKey, bytes, "image/jpeg");
  }

  const entry = await ctx.db.$transaction(async (tx) => {
    await lockEmployee(tx, ctx.tenantId, employeeId);
    const state = await getShiftState(ctx, employeeId, env.now, tx);
    const t = canTransition(state.status, input.type);
    if (!t.ok) throw new AppError(t.error, { status: state.status });

    const workDate = input.type === "CHECK_IN" ? state.todayKey : state.workDate;
    const created = await tx.logEntry.create({
      data: {
        tenantId: ctx.tenantId,
        employeeId,
        workDate: dateKeyToDb(workDate),
        type: input.type,
        breakKind: input.type === "BREAK" ? (input.breakKind as LogEntry["breakKind"]) : null,
        note: input.note || null,
        occurredAt: env.now,
        recordedAt: env.now,
        source: "SELF",
        createdById: ctx.actor.userId,
        ip: env.ip,
        deviceId: gate.deviceId,
        photoKey,
      },
    });
    if (gate.deviceId) {
      await tx.device.update({ where: { id: gate.deviceId }, data: { lastSeenAt: env.now, lastIp: env.ip } });
    }
    await audit(
      ctx,
      {
        action: `attendance.${input.type.toLowerCase()}`,
        entityType: "LogEntry",
        entityId: created.id,
        subjectEmployeeId: employeeId,
        ip: env.ip, at: env.now,
        after: { type: created.type, breakKind: created.breakKind, note: created.note, occurredAt: created.occurredAt.toISOString(), workDate },
      },
      tx,
    );
    await recomputeDay(ctx, employeeId, workDate, env.now, tx);
    return created;
  });

  return { entryId: entry.id, workDate: dbToDateKey(entry.workDate) };
}

/**
 * Idle prompt answer "Yes, I was on a break": back-dates a BREAK to when the tab
 * went idle and resumes ON_DUTY now. Only ever initiated by the employee.
 */
export async function recordIdleBreak(ctx: TenantCtx, raw: { idleSince: Date | string; breakKind: string }, env: RequestEnv) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const input = idleBreakInput.parse(raw);

  const gate = await checkGate(ctx, employeeId, env);
  if (!gate.ok) throw new AppError(gate.reason);

  return ctx.db.$transaction(async (tx) => {
    await lockEmployee(tx, ctx.tenantId, employeeId);
    const state = await getShiftState(ctx, employeeId, env.now, tx);
    if (state.status !== "ON_DUTY") throw new AppError("IDLE_BREAK_NOT_ON_DUTY");
    const since = state.computation.statusSince;
    if (!since || input.idleSince <= since) throw new AppError("IDLE_BREAK_BEFORE_STATUS");
    if (input.idleSince >= env.now) throw new AppError("IDLE_BREAK_IN_FUTURE");
    if (env.now.getTime() - input.idleSince.getTime() > 12 * 3600_000) throw new AppError("IDLE_BREAK_TOO_OLD");

    const common = {
      tenantId: ctx.tenantId,
      employeeId,
      workDate: dateKeyToDb(state.workDate),
      recordedAt: env.now,
      source: "IDLE_PROMPT" as const,
      createdById: ctx.actor.userId,
      ip: env.ip,
      deviceId: gate.deviceId,
    };
    const brk = await tx.logEntry.create({
      data: { ...common, type: "BREAK", breakKind: input.breakKind as LogEntry["breakKind"], occurredAt: input.idleSince },
    });
    const resume = await tx.logEntry.create({ data: { ...common, type: "ON_DUTY", occurredAt: env.now } });
    await audit(
      ctx,
      {
        action: "attendance.idle_break",
        entityType: "LogEntry",
        entityId: brk.id,
        subjectEmployeeId: employeeId,
        ip: env.ip, at: env.now,
        reason: "Employee confirmed a break when prompted after inactivity",
        after: { breakFrom: input.idleSince.toISOString(), breakTo: env.now.toISOString(), breakKind: input.breakKind, resumeEntryId: resume.id },
      },
      tx,
    );
    await recomputeDay(ctx, employeeId, state.workDate, env.now, tx);
    return { breakEntryId: brk.id, resumeEntryId: resume.id };
  });
}

// ───────────────────────────── Day record & certification ─────────────────────────────

export function logHash(entries: readonly LogEntry[]): string {
  const canonical = effectiveEntries(entries).map((e) => [e.id, e.type, e.breakKind ?? "", e.occurredAt.toISOString(), e.note ?? ""]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Rebuild the derived DayRecord from the append-only entries. Idempotent. */
export async function recomputeDay(ctx: TenantCtx, employeeId: string, workDate: DateKey, now: Date, db: TenantClient = ctx.db) {
  const entries = await loadDayEntries(db, employeeId, workDate);
  const comp = computeDay(entries, { now, staleAfterMs: staleShiftMs() });
  const lastCert = await db.dayCertification.findFirst({
    where: { employeeId, workDate: dateKeyToDb(workDate) },
    orderBy: { certifiedAt: "desc" },
  });
  const certified = !!lastCert && lastCert.logHash === logHash(entries);

  let state: DayState;
  if (comp.missedCheckout) state = "MISSED_CHECKOUT";
  else if (comp.status !== "OFF") state = "OPEN";
  else if (certified) state = "CERTIFIED";
  else state = "CLOSED";

  const flags: string[] = [];
  if (comp.missedCheckout) flags.push("MISSED_CHECKOUT");
  if (comp.anomalies.length) flags.push("SEQUENCE_ANOMALY");
  if (lastCert && !certified) flags.push("RECERTIFY_REQUIRED");

  const data = {
    state,
    firstInAt: comp.firstInAt,
    lastOutAt: comp.lastOutAt,
    workMin: toMinutes(comp.workSeconds),
    breakMin: toMinutes(comp.breakSeconds),
    fieldMin: toMinutes(comp.fieldSeconds),
    flags,
    computedAt: now,
  };
  return db.dayRecord.upsert({
    where: { tenantId_employeeId_workDate: { tenantId: ctx.tenantId, employeeId, workDate: dateKeyToDb(workDate) } },
    create: { tenantId: ctx.tenantId, employeeId, workDate: dateKeyToDb(workDate), ...data },
    update: data,
  });
}

export async function certifyDay(ctx: TenantCtx, raw: z.input<typeof certifyInput>, env: RequestEnv) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const parsed = certifyInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", { issues: parsed.error.issues.map((i) => i.path.join(".")) });
  const { workDate, summary } = parsed.data;

  return ctx.db.$transaction(async (tx) => {
    await lockEmployee(tx, ctx.tenantId, employeeId);
    const entries = await loadDayEntries(tx, employeeId, workDate);
    if (entries.length === 0) throw new AppError("NOTHING_TO_CERTIFY");
    const comp = computeDay(entries, { now: env.now, staleAfterMs: staleShiftMs() });
    if (comp.missedCheckout) throw new AppError("CERTIFY_MISSED_CHECKOUT");
    if (comp.status !== "OFF") throw new AppError("CERTIFY_NOT_CHECKED_OUT");
    const hash = logHash(entries);
    const last = await tx.dayCertification.findFirst({
      where: { employeeId, workDate: dateKeyToDb(workDate) },
      orderBy: { certifiedAt: "desc" },
    });
    if (last?.logHash === hash) throw new AppError("ALREADY_CERTIFIED");

    const cert = await tx.dayCertification.create({
      data: { tenantId: ctx.tenantId, employeeId, workDate: dateKeyToDb(workDate), summary, logHash: hash, certifiedAt: env.now },
    });
    await audit(
      ctx,
      {
        action: last ? "day.recertified" : "day.certified",
        entityType: "DayCertification",
        entityId: cert.id,
        subjectEmployeeId: employeeId,
        ip: env.ip, at: env.now,
        after: { workDate, summary, logHash: hash },
      },
      tx,
    );
    await recomputeDay(ctx, employeeId, workDate, env.now, tx);
    return cert;
  });
}

// ───────────────────────────── Views ─────────────────────────────

/** Self, the employee's direct manager, or a company admin. */
export async function assertCanViewEmployee(ctx: TenantCtx, employeeId: string) {
  if (ctx.actor.employeeId === employeeId || ctx.actor.role === "COMPANY_ADMIN") return;
  if (ctx.actor.role === "MANAGER") {
    const emp = await ctx.db.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
    if (emp && emp.managerId === ctx.actor.employeeId) return;
  }
  throw new AppError("FORBIDDEN");
}

export async function getMonth(ctx: TenantCtx, employeeId: string, year: number, month: number, now: Date) {
  await assertCanViewEmployee(ctx, employeeId);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  let records = await ctx.db.dayRecord.findMany({
    where: { employeeId, workDate: { gte: from, lt: to } },
    orderBy: { workDate: "asc" },
  });
  // Open days may have gone stale since last computed (missed check-out) — refresh lazily.
  const stale = records.filter((r) => r.state === "OPEN" && now.getTime() - r.computedAt.getTime() > 60_000);
  if (stale.length) {
    await Promise.all(stale.map((r) => recomputeDay(ctx, employeeId, dbToDateKey(r.workDate), now)));
    records = await ctx.db.dayRecord.findMany({
      where: { employeeId, workDate: { gte: from, lt: to } },
      orderBy: { workDate: "asc" },
    });
  }
  return records;
}

export async function getDayDetail(ctx: TenantCtx, employeeId: string, workDate: DateKey, now: Date) {
  await assertCanViewEmployee(ctx, employeeId);
  const entries = await loadDayEntries(ctx.db, employeeId, workDate);
  const computation = computeDay(entries, { now, staleAfterMs: staleShiftMs() });
  const certifications = await ctx.db.dayCertification.findMany({
    where: { employeeId, workDate: dateKeyToDb(workDate) },
    orderBy: { certifiedAt: "desc" },
  });
  const currentHash = entries.length ? logHash(entries) : null;
  const entryIds = entries.map((e) => e.id);
  const auditEvents = await ctx.db.auditEvent.findMany({
    where: {
      subjectEmployeeId: employeeId,
      OR: [
        { entityId: { in: [...entryIds, ...certifications.map((c) => c.id)] } },
        { action: "attendance.denied", createdAt: { gte: new Date(dateKeyToDb(workDate).getTime() - 86400_000), lt: new Date(dateKeyToDb(workDate).getTime() + 2 * 86400_000) } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  const superseded = new Set(entries.map((e) => e.supersedesId).filter(Boolean));
  return {
    entries: entries.map((e) => ({ ...e, superseded: superseded.has(e.id) })),
    computation,
    certifications,
    isCertified: !!certifications[0] && certifications[0].logHash === currentHash,
    auditEvents,
  };
}

/** Most recent closed-but-uncertified day in the last two weeks (for the "certify your log" prompt). */
export async function pendingCertification(ctx: TenantCtx, employeeId: string, now: Date) {
  const since = new Date(now.getTime() - 14 * 86400_000);
  return ctx.db.dayRecord.findFirst({
    where: { employeeId, state: "CLOSED", workDate: { gte: since } },
    orderBy: { workDate: "desc" },
  });
}
