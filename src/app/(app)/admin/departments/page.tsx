import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listDepartments } from "@/server/services/org";
import { ActionForm } from "@/components/action-form";
import { EmptyState, Input, PageHeader, Panel } from "@/components/ui";
import { createDepartmentAction, renameDepartmentAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("departments") };
}

export default async function DepartmentsPage() {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.departments");
  const departments = await listDepartments(ctx);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel title={t("list")}>
          {departments.length === 0 ? (
            <EmptyState title={t("empty")} />
          ) : (
            <ul className="divide-y divide-rule">
              {departments.map((d) => (
                <li key={d.id} className="py-3">
                  <ActionForm action={renameDepartmentAction.bind(null, d.id)} submitLabel={t("rename")} variant="secondary" className="flex flex-wrap items-center gap-3">
                    <Input name="name" defaultValue={d.name} aria-label={t("name")} className="max-w-xs" required />
                    <span className="text-xs text-ink-3">{t("count", { count: d._count.employees })}</span>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("add")}>
          <ActionForm action={createDepartmentAction} submitLabel={t("add")} resetOnSuccess>
            <Input name="name" placeholder={t("name")} aria-label={t("name")} required minLength={2} />
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
