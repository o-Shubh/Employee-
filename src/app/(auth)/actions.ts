"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { changeOwnPassword } from "@/server/auth/account";
import { requestPasswordReset, resetPasswordWithToken } from "@/server/auth/password-reset";
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
  // Other sessions are now invalid; sign this one back in with the new password.
  await signIn("credentials", { email: user.email, password: next, redirectTo: "/" });
  return {};
}

export async function acceptConsentAction() {
  const ctx = await requireUser({ allowIncompleteOnboarding: true });
  const env = await requestEnv(ctx.actor.employeeId);
  await recordConsent(ctx, env);
  redirect("/dashboard");
}

export async function forgotPasswordAction(_prev: { sent?: boolean } | undefined, form: FormData) {
  const env = await requestEnv();
  await requestPasswordReset(String(form.get("email") ?? ""), env.ip, env.now);
  return { sent: true };
}

export async function resetPasswordAction(_prev: { error?: string } | undefined, form: FormData) {
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { error: "PASSWORD_MISMATCH" };
  const env = await requestEnv();
  const res = await run(() => resetPasswordWithToken(String(form.get("token") ?? ""), next, env.ip, env.now));
  if (!res.ok) return { error: res.code };
  await signIn("credentials", { email: res.data.email, password: next, redirectTo: "/" });
  return {};
}
