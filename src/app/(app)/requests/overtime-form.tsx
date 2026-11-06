"use client";
import { useTranslations } from "next-intl";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import { requestOvertimeAction } from "@/app/(app)/request-actions";

export function OvertimeForm({ today }: { today: string }) {
  const t = useTranslations("requests");
  return (
    <ActionForm action={requestOvertimeAction} submitLabel={t("submitOvertime")} successText={t("overtimeSubmitted")} resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <Field label={t("date")} htmlFor="ot-date" hint={t("dateHint")}>
          <Input id="ot-date" name="workDate" type="date" defaultValue={today} required />
        </Field>
        <Field label={t("hours")} htmlFor="ot-hours">
          <Input id="ot-hours" name="hours" type="number" min={0} max={12} defaultValue={1} className="w-24" />
        </Field>
        <Field label={t("minutes")} htmlFor="ot-min">
          <Input id="ot-min" name="minutes" type="number" min={0} max={59} step={15} defaultValue={0} className="w-24" />
        </Field>
      </div>
      <Field label={t("reason")} htmlFor="ot-reason">
        <Textarea id="ot-reason" name="reason" rows={2} required minLength={5} maxLength={500} placeholder={t("overtimePlaceholder")} />
      </Field>
    </ActionForm>
  );
}
