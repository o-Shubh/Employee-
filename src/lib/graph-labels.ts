import { getTranslations } from "next-intl/server";
import type { DutyGraphLabels } from "@/components/duty-graph";

export async function graphLabels(dateLabel: string): Promise<DutyGraphLabels> {
  const t = await getTranslations("graph");
  return {
    rows: { OFF: t("off"), BREAK: t("break"), ON_DUTY: t("onDuty"), FIELD_DUTY: t("field") },
    total: t("total"),
    title: t("title", { date: dateLabel }),
    unbounded: t("unbounded"),
  };
}
