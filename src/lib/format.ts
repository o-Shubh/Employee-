import { formatInTimeZone } from "date-fns-tz";

/** Display helpers. Everything is stored in UTC and shown in the tenant's time zone. */
export const fmtTime = (d: Date | string, tz: string) => formatInTimeZone(new Date(d), tz, "HH:mm");
export const fmtTimeSec = (d: Date | string, tz: string) => formatInTimeZone(new Date(d), tz, "HH:mm:ss");
export const fmtDateTime = (d: Date | string, tz: string) => formatInTimeZone(new Date(d), tz, "d MMM yyyy, HH:mm");
export const fmtDateKey = (key: string) =>
  new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
