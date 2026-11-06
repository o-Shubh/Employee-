"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Notice } from "@/components/ui";
import { changePasswordAction } from "../actions";

export function ChangePasswordForm() {
  const t = useTranslations("auth");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Notice tone="error">{te(state.error)}</Notice>}
      <Field label={t("currentPassword")} htmlFor="current">
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={t("newPassword")} htmlFor="next" hint={t("passwordRules")}>
        <Input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field label={t("confirmPassword")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {t("savePassword")}
      </Button>
    </form>
  );
}
