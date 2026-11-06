import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getEmployee } from "@/server/services/employees";
import { listAuditForEmployee } from "@/server/services/audit";
import { dbToDateKey } from "@/domain/time";
import { ActionForm } from "@/components/action-form";
import { AuditList } from "@/components/audit-list";
import { PageHeader, Panel } from "@/components/ui";
import { resetPasswordAction, updateEmployeeAction } from "../../actions";
import { EmployeeFields } from "../fields";
import { employeeFormOptions } from "../options";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.employees");
  const e = await getEmployee(ctx, id).catch(() => null);
  if (!e) notFound();
  const [options, events] = await Promise.all([employeeFormOptions(ctx), listAuditForEmployee(ctx, id, { take: 50 })]);

  return (
    <>
      <PageHeader
        title={e.fullName}
        description={`${e.employeeCode}, ${e.user.email}`}
        actions={
          <Link href={`/logs?employee=${e.id}`} className="text-sm text-primary hover:underline">
            {t("viewLogs")}
          </Link>
        }
      />
      <div className="space-y-6">
        <Panel title={t("editTitle")}>
          <ActionForm action={updateEmployeeAction.bind(null, e.id)} submitLabel={t("save")} successText={t("saved")}>
            <EmployeeFields
              options={options}
              mode="edit"
              selfId={e.id}
              defaults={{ ...e, email: e.user.email, role: e.user.role, joinedOn: e.joinedOn ? dbToDateKey(e.joinedOn) : null }}
            />
          </ActionForm>
        </Panel>
        <Panel title={t("resetTitle")}>
          <p className="mb-3 text-sm text-ink-2">{t("resetHelp")}</p>
          <ActionForm action={resetPasswordAction.bind(null, e.id)} submitLabel={t("reset")} variant="secondary">
            <></>
          </ActionForm>
        </Panel>
        <Panel title={t("history")}>
          <AuditList events={events} timezone={ctx.tenant.timezone} emptyText={t("noHistory")} />
        </Panel>
      </div>
    </>
  );
}
