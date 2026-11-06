import { getTranslations } from "next-intl/server";
import { listPlans } from "@/server/services/super-admin";
import { ActionForm } from "@/components/action-form";
import { Field, Input, PageHeader, Panel } from "@/components/ui";
import { savePlanAction } from "../actions";

async function PlanFields({ d }: { d?: { code: string; name: string; maxEmployees: number; priceMonthlyInr: number } }) {
  const t = await getTranslations("super");
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <Field label={t("planCode")}>
        <Input name="code" defaultValue={d?.code} required />
      </Field>
      <Field label={t("planName")}>
        <Input name="name" defaultValue={d?.name} required />
      </Field>
      <Field label={t("maxEmployees")}>
        <Input name="maxEmployees" type="number" min={1} defaultValue={d?.maxEmployees} required />
      </Field>
      <Field label={t("price")}>
        <Input name="priceMonthlyInr" type="number" min={0} defaultValue={d?.priceMonthlyInr ?? 0} required />
      </Field>
    </div>
  );
}

export default async function PlansPage() {
  const t = await getTranslations("super");
  const plans = await listPlans();
  return (
    <>
      <PageHeader title={t("plansTitle")} description={t("plansDescription")} />
      <div className="space-y-6">
        {plans.map((p) => (
          <Panel key={p.id} title={t("planWithTenants", { name: p.name, count: p._count.tenants })}>
            <ActionForm action={savePlanAction.bind(null, p.id)} submitLabel={t("save")} successText={t("saved")}>
              <PlanFields d={p} />
            </ActionForm>
          </Panel>
        ))}
        <Panel title={t("newPlan")}>
          <ActionForm action={savePlanAction.bind(null, null)} submitLabel={t("createPlan")} resetOnSuccess>
            <PlanFields />
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
