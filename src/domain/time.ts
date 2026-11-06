import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TZ = "Asia/Kolkata";

/** A tenant-local calendar date as "YYYY-MM-DD". */
export type DateKey = string;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(s: string): s is DateKey {
  if (!DATE_KEY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Local calendar date of an instant in a time zone. */
export function localDateKey(instant: Date, tz: string): DateKey {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

/** Prisma @db.Date <-> DateKey. Dates are carried as UTC midnight. */
export function dateKeyToDb(key: DateKey): Date {
  if (!isDateKey(key)) throw new Error(`Invalid date key: ${key}`);
  return new Date(`${key}T00:00:00.000Z`);
}
export function dbToDateKey(d: Date): DateKey {
  return d.toISOString().slice(0, 10);
}

/** UTC instant of local midnight at the start of `key` in `tz`. */
export function startOfLocalDay(key: DateKey, tz: string): Date {
  return fromZonedTime(`${key}T00:00:00`, tz);
}

/** Convert a local wall-clock time ("YYYY-MM-DD", "HH:mm") in tz to a UTC instant. */
export function localToUtc(key: DateKey, hhmm: string, tz: string): Date {
  return fromZonedTime(`${key}T${hhmm}:00`, tz);
}

export function formatLocal(instant: Date, tz: string, pattern = "HH:mm"): string {
  return formatInTimeZone(instant, tz, pattern);
}

export function addDaysKey(key: DateKey, days: number): DateKey {
  const d = dateKeyToDb(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dbToDateKey(d);
}

/** All date keys of a month (month is 1-12). */
export function monthDateKeys(year: number, month: number): DateKey[] {
  const out: DateKey[] = [];
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCMonth() === month - 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** ISO weekday, 1 = Monday ... 7 = Sunday */
export function isoWeekday(key: DateKey): number {
  const wd = dateKeyToDb(key).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
