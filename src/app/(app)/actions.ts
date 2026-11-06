"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser, requestEnv } from "@/server/auth/session";
import { run } from "@/server/actions";
import { certifyDay, punch, recordIdleBreak, type PunchInput } from "@/server/services/attendance";
import { requestDeviceRegistration } from "@/server/services/devices";
import { DEVICE_COOKIE_MAX_AGE, deviceCookieName } from "@/server/security/device-token";
import { signOut } from "@/server/auth";

export async function punchAction(input: PunchInput) {
  const ctx = await requireUser();
  const env = await requestEnv(ctx.actor.employeeId);
  const res = await run(() => punch(ctx, input, env));
  revalidatePath("/", "layout");
  return res;
}

export async function idleBreakAction(input: { idleSince: string; breakKind: string }) {
  const ctx = await requireUser();
  const env = await requestEnv(ctx.actor.employeeId);
  const res = await run(() => recordIdleBreak(ctx, { idleSince: new Date(input.idleSince), breakKind: input.breakKind }, env));
  revalidatePath("/", "layout");
  return res;
}

export async function certifyAction(input: { workDate: string; summary: string; certify: boolean }) {
  const ctx = await requireUser();
  const env = await requestEnv(ctx.actor.employeeId);
  const res = await run(async () => {
    await certifyDay(ctx, { ...input, certify: input.certify as true }, env);
  });
  revalidatePath("/", "layout");
  return res;
}

export async function registerDeviceAction(input: { label: string }) {
  const ctx = await requireUser();
  const env = await requestEnv(ctx.actor.employeeId);
  const res = await run(() => requestDeviceRegistration(ctx, input, env));
  if (res.ok && ctx.actor.employeeId) {
    (await cookies()).set(deviceCookieName(ctx.actor.employeeId), res.data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE,
    });
  }
  revalidatePath("/device");
  return res.ok ? { ok: true as const } : res;
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
