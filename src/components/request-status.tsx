import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui";

const TONE = { PENDING: "break", APPROVED: "duty", REJECTED: "danger", CANCELLED: "off" } as const;

export async function RequestStatus({ status }: { status: keyof typeof TONE }) {
  const t = await getTranslations("requestStatus");
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
}
