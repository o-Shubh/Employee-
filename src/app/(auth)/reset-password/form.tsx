"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Notice } from "@/components/ui";
import { resetPasswordAction } from "../actions";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const te = useTranslations("errors");
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state?.error && <Notice tone="error">{te.has(state.error) ? te(state.error) : te("UNEXPECTED")}</Notice>}
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
