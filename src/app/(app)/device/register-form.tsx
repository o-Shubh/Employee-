"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { registerDeviceAction } from "@/app/(app)/actions";
import { Button, Input, Notice } from "@/components/ui";

export function RegisterDeviceForm() {
  const t = useTranslations("device");
  const te = useTranslations("errors");
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await registerDeviceAction({ label });
          if (!r.ok) setError(r.code);
          else router.refresh();
        });
      }}
    >
      <div className="flex-1 space-y-1.5">
        <label htmlFor="device-label" className="text-sm font-medium">
          {t("labelField")}
        </label>
        <Input id="device-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPlaceholder")} minLength={2} maxLength={80} required />
      </div>
      <Button type="submit" disabled={pending || label.trim().length < 2}>
        {t("register")}
      </Button>
      {error && (
        <div className="sm:basis-full">
          <Notice tone="error">{te.has(error) ? te(error) : te("UNEXPECTED")}</Notice>
        </div>
      )}
    </form>
  );
}
