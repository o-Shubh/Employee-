import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listMyDevices } from "@/server/services/devices";
import { deviceCookieName, hashDeviceToken } from "@/server/security/device-token";
import { fmtDateTime } from "@/lib/format";
import { Badge, EmptyState, Notice, PageHeader, Panel, Table } from "@/components/ui";
import { RegisterDeviceForm } from "./register-form";

const TONE = { PENDING: "break", APPROVED: "duty", REJECTED: "danger", REVOKED: "off" } as const;

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("device") };
}

export default async function DevicePage() {
  const ctx = await requireUser();
  const t = await getTranslations("device");
  const devices = await listMyDevices(ctx);
  const token = ctx.actor.employeeId ? (await cookies()).get(deviceCookieName(ctx.actor.employeeId))?.value : undefined;
  const thisHash = token ? hashDeviceToken(token) : null;
  const current = devices.find((d) => d.tokenHash === thisHash);
  const tz = ctx.tenant.timezone;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        {current?.status === "APPROVED" && <Notice tone="success">{t("thisApproved", { label: current.label })}</Notice>}
        {current?.status === "PENDING" && <Notice tone="info">{t("thisPending", { label: current.label })}</Notice>}
        {(current?.status === "REJECTED" || current?.status === "REVOKED") && <Notice tone="error">{t("thisRevoked")}</Notice>}
        {(!current || current.status === "REJECTED" || current.status === "REVOKED") && (
          <Panel title={t("registerTitle")}>
            <p className="mb-4 text-sm text-ink-2">{t("registerHelp")}</p>
            <RegisterDeviceForm />
          </Panel>
        )}
        <Panel title={t("myDevices")}>
          {devices.length === 0 ? (
            <EmptyState title={t("none")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("label")}</th>
                  <th>{t("status")}</th>
                  <th>{t("requested")}</th>
                  <th>{t("lastUsed")}</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.label}
                      {d.tokenHash === thisHash && <span className="ml-2 text-xs text-ink-3">{t("thisComputer")}</span>}
                    </td>
                    <td>
                      <Badge tone={TONE[d.status]}>{t(`statusValue.${d.status}`)}</Badge>
                    </td>
                    <td className="tabular">{fmtDateTime(d.requestedAt, tz)}</td>
                    <td className="tabular">{d.lastSeenAt ? fmtDateTime(d.lastSeenAt, tz) : "—"}</td>
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
