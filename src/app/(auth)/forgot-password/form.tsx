"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Notice } from "@/components/ui";
import { forgotPasswordAction } from "../actions";

export function ForgotForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(forgotPasswordAction, undefined);
  if (state?.sent) return <Notice tone="success">{t("forgotSent")}</Notice>;
  return (
    <form action={action} className="space-y-4">
      <Field label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {t("sendLink")}
      </Button>
    </form>
  );
}
