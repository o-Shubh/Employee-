import { getTranslations } from "next-intl/server";
import ipaddr from "ipaddr.js";
import { requireUser, requestEnv } from "@/server/auth/session";
import { UseMyNetwork } from "./use-my-network";
import { listLocations } from "@/server/services/org";
import { ActionForm } from "@/components/action-form";
import { EmptyState, Field, Input, Notice, PageHeader, Panel, Textarea } from "@/components/ui";
import { saveLocationAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("locations") };
}

async function LocationFields({ defaults, me }: { defaults?: { name: string; address: string | null; cidrs: string[]; active: boolean }; me: { ip: string | null; isPrivate: boolean } }) {
  const t = await getTranslations("admin.locations");
  return (
    <div className="space-y-4">
      <Field label={t("name")}>
        <Input name="name" defaultValue={defaults?.name} required minLength={2} />
      </Field>
      <Field label={t("address")}>
        <Input name="address" defaultValue={defaults?.address ?? ""} />
      </Field>
      <Field label={t("cidrs")} hint={t("cidrsHint")}>
        <Textarea name="cidrs" rows={3} defaultValue={defaults?.cidrs.join("\n")} required className="font-mono text-xs" />
      </Field>
      <UseMyNetwork ip={me.ip} isPrivate={me.isPrivate} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={defaults?.active ?? true} className="size-4" />
        {t("active")}
      </label>
    </div>
  );
}

export default async function LocationsPage() {
  const ctx = await requireUser({ roles: ["COMPANY_ADMIN"] });
  const t = await getTranslations("admin.locations");
  const locations = await listLocations(ctx);
  const { ip } = await requestEnv();
  const me = { ip, isPrivate: ip ? ipaddr.process(ip).range() !== "unicast" : false };
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        {locations.length === 0 && <Notice tone="warning">{t("noneWarning")}</Notice>}
        <div className="grid gap-6 lg:grid-cols-2">
          {locations.map((l) => (
            <Panel key={l.id} title={`${l.name}${l.active ? "" : ` (${t("inactive")})`}`}>
              <p className="mb-4 text-xs text-ink-3">{t("assigned", { count: l._count.employees })}</p>
              <ActionForm action={saveLocationAction.bind(null, l.id)} submitLabel={t("save")} successText={t("saved")}>
                <LocationFields defaults={l} me={me} />
              </ActionForm>
            </Panel>
          ))}
          <Panel title={t("addTitle")}>
            <ActionForm action={saveLocationAction.bind(null, null)} submitLabel={t("add")} resetOnSuccess>
              <LocationFields me={me} />
            </ActionForm>
          </Panel>
        </div>
        {locations.length === 0 && <EmptyState title={t("empty")} />}
      </div>
    </>
  );
}
