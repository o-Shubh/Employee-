import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("loginTitle") };
}

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const t = await getTranslations("auth");
  return (
    <div className="rounded-lg border border-rule bg-surface p-8">
      <p className="text-lg font-semibold tracking-tight">WorkLog</p>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t("loginTitle")}</h1>
      <p className="mt-1 text-sm text-ink-2">{t("loginSubtitle")}</p>
      <div className="mt-6">
        <LoginForm />
      </div>
    </div>
  );
}
