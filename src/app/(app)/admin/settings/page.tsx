import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { ActionForm } from "@/components/action-form";
import { Field, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { saveSettingsAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("settings") };
}

export default async function SettingsPage() {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.settings");
  const days = t.raw("weekdays") as string[];
  const tn = ctx.tenant;
  const box = (name: string, checked: boolean, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 size-4" />
      <span>
        {label}
        <span className="block text-xs text-ink-3">{hint}</span>
      </span>
    </label>
  );
  return (
    <>
      <PageHeader title={t("title")} description={t("description", { tz: tn.timezone })} />
      <Panel>
        <ActionForm action={saveSettingsAction} submitLabel={t("save")} successText={t("saved")} className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t("attendance")}</h2>
            {box("allowFieldCheckoutAnywhere", tn.allowFieldCheckoutAnywhere, t("fieldCheckout"), t("fieldCheckoutHint"))}
            {box("requirePhotoAtCheckIn", tn.requirePhotoAtCheckIn, t("photo"), t("photoHint"))}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("idle")} hint={t("idleHint")}>
                <Input name="idleTimeoutMin" type="number" min={5} max={240} defaultValue={tn.idleTimeoutMin} required />
              </Field>
              <Field label={t("retention")} hint={t("retentionHint")}>
                <Input name="photoRetentionDays" type="number" min={7} max={3650} defaultValue={tn.photoRetentionDays} required />
              </Field>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">{t("weeklyOff")}</legend>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {days.map((d, i) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="weeklyOffDays" value={i + 1} defaultChecked={tn.weeklyOffDays.includes(i + 1)} className="size-4" />
                    {d}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-3">{t("weeklyOffHint")}</p>
            </fieldset>
          </section>
          <section className="space-y-3 border-t border-rule pt-5">
            <h2 className="text-sm font-semibold">{t("approvals")}</h2>
            <Field label={t("escalation")} hint={t("escalationHint")}>
              <Input name="escalationDays" type="number" min={1} max={30} defaultValue={tn.escalationDays} className="w-28" required />
            </Field>
          </section>
          <section className="space-y-3 border-t border-rule pt-5">
            <h2 className="text-sm font-semibold">{t("privacy")}</h2>
            <Field label={t("grievance")} hint={t("grievanceHint")}>
              <Textarea name="grievanceContact" rows={2} maxLength={300} defaultValue={tn.grievanceContact ?? ""} />
            </Field>
          </section>
        </ActionForm>
      </Panel>
    </>
  );
}
