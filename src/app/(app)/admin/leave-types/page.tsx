import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listLeaveTypes } from "@/server/services/leave";
import { localDateKey } from "@/domain/time";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { adjustBalanceAction, allocateYearAction, saveLeaveTypeAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("leaveTypes") };
}

async function TypeFields({ d }: { d?: { code: string; name: string; yearlyQuota: unknown; tracksBalance: boolean; paid: boolean; halfDayAllowed: boolean; active: boolean } }) {
  const t = await getTranslations("admin.leaveTypes");
  const box = (name: string, label: string, checked: boolean) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="size-4" />
      {label}
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[6rem_1fr_7rem]">
        <Field label={t("code")}>
          <Input name="code" defaultValue={d?.code} required maxLength={10} />
        </Field>
        <Field label={t("name")}>
          <Input name="name" defaultValue={d?.name} required />
        </Field>
        <Field label={t("quota")}>
          <Input name="yearlyQuota" type="number" min={0} max={365} step={0.5} defaultValue={d ? String(d.yearlyQuota) : "0"} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {box("tracksBalance", t("tracksBalance"), d?.tracksBalance ?? true)}
        {box("paid", t("paid"), d?.paid ?? true)}
        {box("halfDayAllowed", t("halfDay"), d?.halfDayAllowed ?? true)}
        {box("active", t("active"), d?.active ?? true)}
      </div>
    </div>
  );
}

export default async function LeaveTypesPage() {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.leaveTypes");
  const year = Number(localDateKey(new Date(), ctx.tenant.timezone).slice(0, 4));
  const [types, employees, allocations] = await Promise.all([
    listLeaveTypes(ctx),
    ctx.db.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, employeeCode: true } }),
    ctx.db.leaveLedger.count({ where: { year, kind: "ALLOCATION" } }),
  ]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        {types.length > 0 && allocations === 0 && <Notice tone="warning">{t("notAllocated", { year })}</Notice>}
        <div className="grid gap-6 lg:grid-cols-2">
          {types.map((ty) => (
            <Panel key={ty.id} title={`${ty.name} (${ty.code})`}>
              <ActionForm action={saveLeaveTypeAction.bind(null, ty.id)} submitLabel={t("save")} successText={t("saved")}>
                <TypeFields d={ty} />
              </ActionForm>
            </Panel>
          ))}
          <Panel title={t("addTitle")}>
            <ActionForm action={saveLeaveTypeAction.bind(null, null)} submitLabel={t("add")} resetOnSuccess>
              <TypeFields />
            </ActionForm>
          </Panel>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t("allocateTitle")}>
            <p className="mb-3 text-sm text-ink-2">{t("allocateHelp")}</p>
            <ActionForm action={allocateYearAction} submitLabel={t("allocate")} className="flex flex-wrap items-end gap-3">
              <Field label={t("year")}>
                <Input name="year" type="number" defaultValue={year} min={2000} max={2100} className="w-28" />
              </Field>
            </ActionForm>
          </Panel>
          <Panel title={t("adjustTitle")}>
            <p className="mb-3 text-sm text-ink-2">{t("adjustHelp")}</p>
            <ActionForm action={adjustBalanceAction} submitLabel={t("adjust")} successText={t("adjusted")} resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("employee")}>
                  <Select name="employeeId" required>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.employeeCode})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("type")}>
                  <Select name="leaveTypeId" required>
                    {types.filter((x) => x.tracksBalance).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("year")}>
                  <Input name="year" type="number" defaultValue={year} required />
                </Field>
                <Field label={t("days")} hint={t("daysHint")}>
                  <Input name="days" type="number" step={0.5} required />
                </Field>
              </div>
              <Field label={t("reason")}>
                <Input name="reason" required minLength={3} maxLength={300} placeholder={t("reasonPlaceholder")} />
              </Field>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
