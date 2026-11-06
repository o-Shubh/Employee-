"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { certifyAction } from "@/app/(app)/actions";
import { Button, Notice, Textarea } from "@/components/ui";

/** End-of-day summary and certification ("I certify this log is accurate"). */
export function CertifyForm({ workDate, dateLabel }: { workDate: string; dateLabel: string }) {
  const t = useTranslations("certify");
  const te = useTranslations("errors");
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <Notice tone="success">{t("done", { date: dateLabel })}</Notice>;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await certifyAction({ workDate, summary, certify: agree });
          if (!r.ok) setError(r.code);
          else {
            setDone(true);
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor={`summary-${workDate}`} className="block text-sm font-medium">
        {t("summaryLabel", { date: dateLabel })}
      </label>
      <Textarea
        id={`summary-${workDate}`}
        rows={2}
        maxLength={500}
        required
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder={t("summaryPlaceholder")}
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
        <span>{t("statement")}</span>
      </label>
      {error && <Notice tone="error">{te.has(error) ? te(error) : te("UNEXPECTED")}</Notice>}
      <Button type="submit" disabled={pending || !agree || summary.trim().length < 3}>
        {t("submit")}
      </Button>
    </form>
  );
}
