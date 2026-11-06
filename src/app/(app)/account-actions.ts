"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requestEnv } from "@/server/auth/session";
import { audit } from "@/server/services/audit";
import { markAllRead } from "@/server/services/notifications";
import type { FormState } from "@/components/action-form";

export async function setEmailNotificationsAction(_p: FormState, f: FormData): Promise<FormState> {
  const ctx = await requireUser();
  const env = await requestEnv();
  const on = f.get("emailNotifications") === "on";
  await ctx.db.user.update({ where: { id: ctx.actor.userId }, data: { emailNotifications: on } });
  await audit(ctx, { action: "user.preferences_changed", entityType: "User", entityId: ctx.actor.userId, subjectEmployeeId: ctx.actor.employeeId, ip: env.ip, at: env.now, after: { emailNotifications: on } });
  revalidatePath("/account");
  return { ok: true };
}

export async function markAllReadAction() {
  const ctx = await requireUser();
  await markAllRead(ctx, new Date());
  revalidatePath("/", "layout");
}
