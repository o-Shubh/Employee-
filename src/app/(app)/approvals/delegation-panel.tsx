import { getTranslations } from "next-intl/server";
import type { TenantCtx } from "@/server/context";
import { listDelegations } from "@/server/services/delegations";
import { localDateKey } from "@/domain/time";
import { fmtDateKey } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Input, Panel, Select } from "@/components/ui";
import { createDelegationAction, revokeDelegationAction } from "@/app/(app)/request-actions";

/** "Away? Send your team's requests to someone else for a while." */
export async function DelegationPanel({ ctx }: { ctx: TenantCtx }) {
  const t = await getTranslations("delegation");
  const now = new Date();
  const today = localDateKey(now, ctx.tenant.timezone);
  const isAdmin = ctx.actor.role === "COMPANY_ADMIN";
  const [rows, candidates] = await Promise.all([
    listDelegations(ctx, now),
    ctx.db.employee.findMany({
      where: { status: "ACTIVE", user: { role: { in: ["MANAGER", "COMPANY_ADMIN"] } } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, employeeCode: true, user: { select: { role: true } } },
    }),
  ]);
  const managers = candidates.filter((c) => c.user.role === "MANAGER");
  return (
    <Panel title={t("title")}>
      <p className="mb-4 text-sm text-ink-2">{t("help")}</p>
      {rows.length > 0 && (
        <ul className="mb-5 divide-y divide-rule rounded-md border border-rule">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span>{t("line", { from: r.from.fullName, to: r.to.fullName, start: fmtDateKey(r.start), end: fmtDateKey(r.end) })}</span>
              {r.active ? <Badge tone="duty">{t("active")}</Badge> : <Badge>{t("upcoming")}</Badge>}
              {(isAdmin || r.fromEmployeeId === ctx.actor.employeeId) && (
                <span className="ml-auto">
                  <ActionForm action={revokeDelegationAction.bind(null, r.id)} submitLabel={t("end")} variant="secondary" className="contents">
                    <></>
                  </ActionForm>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={createDelegationAction} submitLabel={t("save")} successText={t("saved")} resetOnSuccess>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isAdmin && (
            <Field label={t("from")}>
              <Select name="fromEmployeeId" required>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("to")}>
            <Select name="toEmployeeId" required>
              {candidates
                .filter((c) => c.id !== ctx.actor.employeeId || isAdmin)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} ({c.employeeCode})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("startDate")}>
            <Input name="startDate" type="date" defaultValue={today} required />
          </Field>
          <Field label={t("endDate")}>
            <Input name="endDate" type="date" defaultValue={today} required />
          </Field>
        </div>
        <Field label={t("reason")}>
          <Input name="reason" maxLength={300} placeholder={t("reasonPlaceholder")} />
        </Field>
      </ActionForm>
    </Panel>
  );
}
