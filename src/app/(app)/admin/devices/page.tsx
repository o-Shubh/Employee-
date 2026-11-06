import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listDevicesForAdmin } from "@/server/services/devices";
import { fmtDateTime } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, Input, PageHeader, Panel, Table } from "@/components/ui";
import { decideDeviceAction } from "../actions";

const TONE = { PENDING: "break", APPROVED: "duty", REJECTED: "danger", REVOKED: "off" } as const;

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("devices") };
}

export default async function DevicesPage() {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.devices");
  const td = await getTranslations("device.statusValue");
  const devices = await listDevicesForAdmin(ctx);
  const pending = devices.filter((d) => d.status === "PENDING");
  const others = devices.filter((d) => d.status !== "PENDING");
  const tz = ctx.tenant.timezone;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        <Panel title={t("pending", { count: pending.length })}>
          {pending.length === 0 ? (
            <EmptyState title={t("noPending")} />
          ) : (
            <ul className="divide-y divide-rule">
              {pending.map((d) => (
                <li key={d.id} className="grid gap-3 py-4 md:grid-cols-[1fr_auto]">
                  <div className="text-sm">
                    <p className="font-medium">
                      {d.employee.fullName} ({d.employee.employeeCode}): {d.label}
                    </p>
                    <p className="text-xs text-ink-3">{t("requestedFrom", { time: fmtDateTime(d.requestedAt, tz), ip: d.requestIp ?? "?" })}</p>
                    <p className="mt-1 break-all text-xs text-ink-3">{d.userAgent}</p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionForm action={decideDeviceAction.bind(null, d.id, "APPROVE")} submitLabel={t("approve")} className="contents">
                      <></>
                    </ActionForm>
                    <ActionForm action={decideDeviceAction.bind(null, d.id, "REJECT")} submitLabel={t("reject")} variant="secondary" className="flex items-start gap-2">
                      <Input name="note" placeholder={t("reason")} aria-label={t("reason")} className="h-10 w-40" />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("all")}>
          {others.length === 0 ? (
            <EmptyState title={t("none")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("employee")}</th>
                  <th>{t("device")}</th>
                  <th>{t("status")}</th>
                  <th>{t("lastUsed")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {others.map((d) => (
                  <tr key={d.id}>
                    <td>{d.employee.fullName}</td>
                    <td>{d.label}</td>
                    <td>
                      <Badge tone={TONE[d.status]}>{td(d.status)}</Badge>
                    </td>
                    <td className="tabular">{d.lastSeenAt ? `${fmtDateTime(d.lastSeenAt, tz)} (${d.lastIp ?? ""})` : "—"}</td>
                    <td>
                      {d.status === "APPROVED" && (
                        <ActionForm action={decideDeviceAction.bind(null, d.id, "REVOKE")} submitLabel={t("revoke")} variant="danger" className="flex items-start gap-2">
                          <Input name="note" placeholder={t("reason")} aria-label={t("reason")} className="h-10 w-36" />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
