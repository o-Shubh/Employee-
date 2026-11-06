import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ForgotForm } from "./form";

export default async function ForgotPage() {
  const t = await getTranslations("auth");
  return (
    <div className="rounded-lg border border-rule bg-surface p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("forgotTitle")}</h1>
      <p className="mt-1 text-sm text-ink-2">{t("forgotSubtitle")}</p>
      <div className="mt-6">
        <ForgotForm />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/login" className="text-primary hover:underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </div>
  );
}
