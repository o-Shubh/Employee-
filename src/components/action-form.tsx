"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Notice } from "@/components/ui";

export type FormState = { ok?: boolean; code?: string; message?: string; nonce?: number } | undefined;

/** A server-action form with translated error/success feedback. Inputs are passed as children. */
export function ActionForm({
  action,
  children,
  submitLabel,
  successText,
  resetOnSuccess = false,
  className = "space-y-4",
  variant = "primary",
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  successText?: string;
  resetOnSuccess?: boolean;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const te = useTranslations("errors");
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.ok === false && state.code && <Notice tone="error">{te.has(state.code) ? te(state.code) : te("UNEXPECTED")}</Notice>}
      {state?.ok && (state.message || successText) && <Notice tone="success">{state.message ?? successText}</Notice>}
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
