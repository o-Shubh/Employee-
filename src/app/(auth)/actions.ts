"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { changeOwnPassword } from "@/server/auth/account";
import { getCurrentUser, requestEnv, requireUser } from "@/server/auth/session";
import { run } from "@/server/actions";
import { recordConsent } from "@/server/services/consent";

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  try {
    await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code === "rate_limited" ? "RATE_LIMITED" : "INVALID_CREDENTIALS";
      return { error: code };
    }
    throw e; // redirect
  }
  return {};
}

export async function changePasswordAction(_prev: { error?: string } | undefined, form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { error: "PASSWORD_MISMATCH" };
  const env = await requestEnv();
  const res = await run(() => changeOwnPassword(user.id, String(form.get("current") ?? ""), next, env.ip));
  if (!res.ok) return { error: res.code };
  redirect("/");
}

export async function acceptConsentAction() {
  const ctx = await requireUser({ allowIncompleteOnboarding: true });
  const env = await requestEnv(ctx.actor.employeeId);
  await recordConsent(ctx, env);
  redirect("/dashboard");
}
