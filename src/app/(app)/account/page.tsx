import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/ui";
import { setEmailNotificationsAction } from "@/app/(app)/account-actions";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("account") };
}

export default async function AccountPage() {
  const ctx = await requireUser();
  const t = await getTranslations("account");
  return (
    <>
      <PageHeader title={t("title")} description={ctx.user.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("emailTitle")}>
          <ActionForm action={setEmailNotificationsAction} submitLabel={t("save")} successText={t("saved")}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="emailNotifications" defaultChecked={ctx.user.emailNotifications} className="mt-0.5 size-4" />
              <span>
                {t("emailToggle")}
                <span className="block text-xs text-ink-3">{t("emailHint")}</span>
              </span>
            </label>
          </ActionForm>
        </Panel>
        <Panel title={t("passwordTitle")}>
          <p className="mb-3 text-sm text-ink-2">{t("passwordHelp")}</p>
          <Link href="/change-password" className="inline-flex h-10 items-center rounded-md border border-rule-strong px-4 text-sm font-medium hover:bg-surface-2">
            {t("changePassword")}
          </Link>
        </Panel>
      </div>
    </>
  );
}
