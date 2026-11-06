import { getTranslations } from "next-intl/server";
import { listPlans, listTenants } from "@/server/services/super-admin";
import { fmtDateTime } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Input, PageHeader, Panel, Select, Table } from "@/components/ui";
import { createTenantAction, tenantPlanAction, tenantStatusAction } from "./actions";

export default async function TenantsPage() {
  const t = await getTranslations("super");
  const [tenants, plans] = await Promise.all([listTenants(), listPlans()]);
  return (
    <>
      <PageHeader title={t("tenantsTitle")} description={t("tenantsDescription")} />
      <div className="space-y-6">
        <Table>
          <thead>
            <tr>
              <th>{t("company")}</th>
              <th>{t("plan")}</th>
              <th>{t("employees")}</th>
              <th>{t("status")}</th>
              <th>{t("createdAt")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tenants.map((x) => (
              <tr key={x.id}>
                <td>
                  <span className="font-medium">{x.name}</span>
                  <span className="block text-xs text-ink-3">
                    {x.slug}, {x.timezone}
                  </span>
                </td>
                <td>
                  <ActionForm action={tenantPlanAction.bind(null, x.id)} submitLabel={t("change")} variant="secondary" className="flex items-center gap-2">
                    <Select name="planId" defaultValue={x.planId} aria-label={t("plan")} className="h-8 w-36 py-1">
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </ActionForm>
                </td>
                <td className="tabular">
                  {x._count.employees} / {x.plan.maxEmployees}
                </td>
                <td>{x.status === "ACTIVE" ? <Badge tone="duty">{t("active")}</Badge> : <Badge tone="danger">{t("suspended")}</Badge>}</td>
                <td className="tabular text-xs">{fmtDateTime(x.createdAt, "Asia/Kolkata")}</td>
                <td>
                  <ActionForm
                    action={tenantStatusAction.bind(null, x.id, x.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")}
                    submitLabel={x.status === "ACTIVE" ? t("suspend") : t("reactivate")}
                    variant={x.status === "ACTIVE" ? "danger" : "secondary"}
                    className="contents"
                  >
                    <></>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Panel title={t("newTenant")}>
          <ActionForm action={createTenantAction} submitLabel={t("createTenant")} resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("company")}>
                <Input name="name" required />
              </Field>
              <Field label={t("slug")} hint={t("slugHint")}>
                <Input name="slug" required pattern="[a-z0-9-]+" />
              </Field>
              <Field label={t("timezone")}>
                <Input name="timezone" defaultValue="Asia/Kolkata" required />
              </Field>
              <Field label={t("plan")}>
                <Select name="planId" required>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("adminName")}>
                <Input name="adminName" required />
              </Field>
              <Field label={t("adminEmail")}>
                <Input name="adminEmail" type="email" required />
              </Field>
            </div>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
