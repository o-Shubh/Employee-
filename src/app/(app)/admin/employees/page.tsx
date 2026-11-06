import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listEmployees } from "@/server/services/employees";
import { ActionForm } from "@/components/action-form";
import { Badge, Input, PageHeader, Panel, Table } from "@/components/ui";
import { createEmployeeAction } from "../actions";
import { EmployeeFields } from "./fields";
import { employeeFormOptions } from "./options";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("employees") };
}

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.employees");
  const tr = await getTranslations("shell.role");
  const { q } = await searchParams;
  const [employees, options] = await Promise.all([listEmployees(ctx, { q }), employeeFormOptions(ctx)]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/admin/employees/import" className="rounded-md border border-rule-strong px-3 py-2 text-sm font-medium hover:bg-surface-2">
            {t("import")}
          </Link>
        }
      />
      <div className="space-y-6">
        <form className="flex max-w-md gap-2">
          <Input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} />
        </form>
        <Table>
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("role")}</th>
              <th>{t("department")}</th>
              <th>{t("manager")}</th>
              <th>{t("location")}</th>
              <th>{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/admin/employees/${e.id}`} className="font-medium text-primary hover:underline">
                    {e.fullName}
                  </Link>
                  <span className="block text-xs text-ink-3">
                    {e.employeeCode}, {e.user.email}
                  </span>
                </td>
                <td>{tr(e.user.role)}</td>
                <td>{e.department?.name ?? "—"}</td>
                <td>{e.manager?.fullName ?? "—"}</td>
                <td>{e.officeLocation?.name ?? t("anyLocation")}</td>
                <td>{e.status === "ACTIVE" ? <Badge tone="duty">{t("active")}</Badge> : <Badge tone="off">{t("inactive")}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Panel title={t("addTitle")}>
          <ActionForm action={createEmployeeAction} submitLabel={t("add")} resetOnSuccess>
            <EmployeeFields options={options} mode="create" />
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
