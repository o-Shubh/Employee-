import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { CSV_HEADERS } from "@/server/services/employees";
import { PageHeader, Panel } from "@/components/ui";
import { ImportForm } from "./import-form";

export default async function ImportPage() {
  await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.import");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        <Panel title={t("formatTitle")}>
          <p className="mb-3 text-sm text-ink-2">{t("formatHelp")}</p>
          <pre className="overflow-x-auto rounded bg-surface-2 p-3 text-xs">
            {CSV_HEADERS.join(",")}
            {"\n"}E101,Asha Verma,asha@example.com,EMPLOYEE,Finance,M01,Head Office,Accountant,2024-04-01
          </pre>
        </Panel>
        <Panel title={t("uploadTitle")}>
          <ImportForm />
        </Panel>
      </div>
    </>
  );
}
