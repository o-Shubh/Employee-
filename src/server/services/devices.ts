import { z } from "zod";
import { AppError } from "../errors";
import { isAdmin, type RequestEnv, type TenantCtx } from "../context";
import { generateDeviceToken, hashDeviceToken } from "../security/device-token";
import { checkGate } from "./attendance";
import { audit } from "./audit";

export const registerDeviceInput = z.object({ label: z.string().trim().min(2).max(80) });

/**
 * Employee asks to register the computer they are on. Must be on the office
 * network. Returns the raw token, which the caller stores in an httpOnly cookie.
 */
export async function requestDeviceRegistration(ctx: TenantCtx, raw: z.input<typeof registerDeviceInput>, env: RequestEnv) {
  const employeeId = ctx.actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE_PROFILE");
  const { label } = registerDeviceInput.parse(raw);

  const gate = await checkGate(ctx, employeeId, env, { requireDevice: false });
  if (!gate.ok) throw new AppError(gate.reason);

  if (env.deviceToken) {
    const existing = await ctx.db.device.findFirst({
      where: { tokenHash: hashDeviceToken(env.deviceToken), employeeId, status: { in: ["PENDING", "APPROVED"] } },
    });
    if (existing) throw new AppError(existing.status === "PENDING" ? "DEVICE_ALREADY_PENDING" : "DEVICE_ALREADY_APPROVED");
  }
  const pendingCount = await ctx.db.device.count({ where: { employeeId, status: "PENDING" } });
  if (pendingCount >= 3) throw new AppError("TOO_MANY_PENDING_DEVICES");

  const token = generateDeviceToken();
  const device = await ctx.db.device.create({
    data: {
      employeeId,
      label,
      tokenHash: hashDeviceToken(token),
      userAgent: env.userAgent?.slice(0, 300) ?? null,
      requestIp: env.ip,
      requestedAt: env.now,
    },
  });
  await audit(ctx, {
    action: "device.requested", entityType: "Device", entityId: device.id, subjectEmployeeId: employeeId, ip: env.ip,
    after: { label, userAgent: device.userAgent },
  });
  return { deviceId: device.id, token };
}

export async function listMyDevices(ctx: TenantCtx) {
  if (!ctx.actor.employeeId) return [];
  return ctx.db.device.findMany({
    where: { employeeId: ctx.actor.employeeId },
    orderBy: { requestedAt: "desc" },
    select: { id: true, label: true, status: true, requestedAt: true, decidedAt: true, lastSeenAt: true, userAgent: true, tokenHash: true },
  });
}

export async function listDevicesForAdmin(ctx: TenantCtx, status?: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED") {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
  return ctx.db.device.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    include: { employee: { select: { fullName: true, employeeCode: true } } },
    take: 500,
  });
}

export const decideDeviceInput = z.object({
  deviceId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT", "REVOKE"]),
  note: z.string().trim().max(300).optional(),
});

export async function decideDevice(ctx: TenantCtx, raw: z.input<typeof decideDeviceInput>, env: RequestEnv) {
  if (!isAdmin(ctx)) throw new AppError("FORBIDDEN");
  const { deviceId, decision, note } = decideDeviceInput.parse(raw);
  const device = await ctx.db.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new AppError("NOT_FOUND");

  const allowed =
    (decision === "APPROVE" && device.status === "PENDING") ||
    (decision === "REJECT" && device.status === "PENDING") ||
    (decision === "REVOKE" && device.status === "APPROVED");
  if (!allowed) throw new AppError("INVALID_DEVICE_TRANSITION");

  const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "REVOKED";
  const updated = await ctx.db.device.update({
    where: { id: deviceId },
    data: { status, decidedById: ctx.actor.userId, decidedAt: env.now, decisionNote: note ?? null },
  });
  await audit(ctx, {
    action: `device.${status.toLowerCase()}`, entityType: "Device", entityId: deviceId,
    subjectEmployeeId: device.employeeId, ip: env.ip, reason: note ?? null,
    before: { status: device.status }, after: { status },
  });
  return updated;
}
