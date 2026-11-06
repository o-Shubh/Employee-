"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Notice } from "@/components/ui";
import type { FormState } from "@/components/action-form";

/** Approve / reject with an optional (required for reject) comment. */
export function DecisionForm({ action }: { action: (p: FormState, f: FormData) => Promise<FormState> }) {
  const t = useTranslations("approvals");
  const te = useTranslations("errors");
  const [state, formAction, pending] = useActionState(action, undefined);
  if (state?.ok) return <p className="text-sm text-ink-3">{t("decided")}</p>;
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="comment" placeholder={t("comment")} aria-label={t("comment")} maxLength={500} className="h-9 min-w-48 flex-1" />
        <Button type="submit" name="decision" value="APPROVE" size="sm" variant="duty" disabled={pending}>
          {t("approve")}
        </Button>
        <Button type="submit" name="decision" value="REJECT" size="sm" variant="secondary" disabled={pending}>
          {t("reject")}
        </Button>
      </div>
      {state?.ok === false && state.code && <Notice tone="error">{te.has(state.code) ? te(state.code) : te("UNEXPECTED")}</Notice>}
    </form>
  );
}
