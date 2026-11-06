import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/ui";
import { ResetForm } from "./form";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <div className="rounded-lg border border-rule bg-surface p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("resetTitle")}</h1>
      <div className="mt-6">
        {token ? <ResetForm token={token} /> : <Notice tone="error">{t("resetMissingToken")}</Notice>}
      </div>
      <p className="mt-6 text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          {t("requestNewLink")}
        </Link>
      </p>
    </div>
  );
}
