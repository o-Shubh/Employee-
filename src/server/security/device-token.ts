import { createHash, randomBytes } from "node:crypto";

export const DEVICE_COOKIE_PREFIX = "wl_dev_";
/** Browsers cap cookie lifetime at 400 days. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 3600;

/** One cookie per employee, so colleagues sharing a computer don't overwrite each other. */
export const deviceCookieName = (employeeId: string) => `${DEVICE_COOKIE_PREFIX}${employeeId}`;

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
