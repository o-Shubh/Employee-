import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { ChangePasswordForm } from "./form";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("auth");
  return (
    <div className="rounded-lg border border-rule bg-surface p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("changePasswordTitle")}</h1>
      <p className="mt-1 text-sm text-ink-2">{user.mustChangePassword ? t("changePasswordForced") : t("changePasswordSubtitle")}</p>
      <div className="mt-6">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
