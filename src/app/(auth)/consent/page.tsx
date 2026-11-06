import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { CURRENT_NOTICE_VERSION, hasCurrentConsent } from "@/server/services/consent";
import { Button } from "@/components/ui";
import { acceptConsentAction } from "../actions";

/** DPDP Act 2023 notice (s.5) shown before any processing; acceptance is recorded with version, time and IP. */
export default async function ConsentPage() {
  const ctx = await requireUser({ allowIncompleteOnboarding: true });
  if (ctx.user.mustChangePassword) redirect("/change-password");
  if (await hasCurrentConsent(ctx)) redirect("/dashboard");
  const t = await getTranslations("consent");
  const sections = ["collect", "notCollect", "purpose", "access", "retention", "rights"] as const;
  return (
    <div className="rounded-lg border border-rule bg-surface p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm text-ink-2">{t("intro", { company: ctx.tenant.name })}</p>
      <div className="mt-6 space-y-5 text-sm leading-relaxed">
        {sections.map((s) => (
          <section key={s}>
            <h2 className="font-semibold text-ink">{t(`${s}.title`)}</h2>
            <p className="mt-1 text-ink-2">{t(`${s}.body`, { company: ctx.tenant.name, days: ctx.tenant.photoRetentionDays })}</p>
          </section>
        ))}
        <section>
          <h2 className="font-semibold text-ink">{t("grievance.title")}</h2>
          <p className="mt-1 text-ink-2">{ctx.tenant.grievanceContact ?? t("grievance.fallback", { company: ctx.tenant.name })}</p>
        </section>
      </div>
      <form action={acceptConsentAction} className="mt-8 space-y-3 border-t border-rule pt-6">
        <p className="text-xs text-ink-3">{t("version", { version: CURRENT_NOTICE_VERSION })}</p>
        <Button type="submit" className="w-full">
          {t("accept")}
        </Button>
      </form>
    </div>
  );
}
