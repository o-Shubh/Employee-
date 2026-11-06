import { createTranslator } from "next-intl";
import type { Prisma } from "@prisma/client";
import messages from "../../../messages/en.json";
import type { TenantCtx } from "../context";
import type { TenantClient } from "../db/tenant";
import { appUrl, type OutgoingEmail } from "../mail";

export type NotificationKind =
  | "leave.requested" | "leave.approved" | "leave.rejected" | "leave.cancelled"
  | "correction.requested" | "correction.approved" | "correction.rejected"
  | "overtime.requested" | "overtime.approved" | "overtime.rejected"
  | "device.requested" | "device.approved" | "device.rejected" | "device.revoked"
  | "delegation.assigned" | "requests.escalated";

export type NotifyParams = Record<string, string | number>;

const t = createTranslator({ locale: "en", messages, namespace: "notifications" });

/** Render a notification's text (also used by the in-app list). */
export function renderNotification(kind: string, params: NotifyParams) {
  const key = kind as NotificationKind;
  return {
    title: t.has(`${key}.title`) ? t(`${key}.title`, params) : kind,
    body: t.has(`${key}.body`) ? t(`${key}.body`, params) : "",
  };
}

/**
 * Write in-app notifications inside the caller's transaction and return the emails
 * to send once it commits (so a rolled-back action never emails anyone).
 */
export async function notify(
  ctx: TenantCtx,
  db: TenantClient,
  userIds: string[],
  kind: NotificationKind,
  params: NotifyParams,
  link: string | null,
): Promise<OutgoingEmail[]> {
  const ids = [...new Set(userIds)].filter((id) => id !== ctx.actor.userId);
  if (ids.length === 0) return [];
  await db.notification.createMany({
    data: ids.map((userId) => ({ tenantId: ctx.tenantId, userId, kind, params: params as Prisma.InputJsonValue, link })),
  });
  const users = await db.user.findMany({ where: { id: { in: ids }, status: "ACTIVE", emailNotifications: true }, select: { email: true } });
  const { title, body } = renderNotification(kind, params);
  const footer = t("emailFooter", { url: appUrl("/account") });
  return users.map((u) => ({
    tenantId: ctx.tenantId,
    to: u.email,
    subject: `[${ctx.tenant.name}] ${title}`,
    text: `${body}\n\n${link ? `${appUrl(link)}\n\n` : ""}${footer}`,
  }));
}

export async function listNotifications(ctx: TenantCtx, take = 50) {
  return ctx.db.notification.findMany({ where: { userId: ctx.actor.userId }, orderBy: { createdAt: "desc" }, take });
}

export async function unreadCount(ctx: TenantCtx) {
  return ctx.db.notification.count({ where: { userId: ctx.actor.userId, readAt: null } });
}

export async function markAllRead(ctx: TenantCtx, now: Date) {
  await ctx.db.notification.updateMany({ where: { userId: ctx.actor.userId, readAt: null }, data: { readAt: now } });
}

export async function adminUserIds(db: TenantClient) {
  const admins = await db.user.findMany({ where: { role: "COMPANY_ADMIN", status: "ACTIVE" }, select: { id: true } });
  return admins.map((a) => a.id);
}

/** Display name of the acting user, for "approved by …" texts. */
export async function actorName(ctx: TenantCtx, db: TenantClient) {
  if (!ctx.actor.employeeId) return "WorkLog";
  const e = await db.employee.findUnique({ where: { id: ctx.actor.employeeId }, select: { fullName: true } });
  return e?.fullName ?? "WorkLog";
}

export const fmtKeyForText = (key: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
