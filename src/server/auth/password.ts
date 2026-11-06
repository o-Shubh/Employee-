import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1)
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;

export const hashPassword = (pw: string) => hash(pw, OPTS);

export async function verifyPassword(hashStr: string, pw: string): Promise<boolean> {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
}

// Used to keep response time constant when the email doesn't exist.
let dummy: string | null = null;
export async function dummyVerify(pw: string) {
  dummy ??= await hashPassword("dummy-password-for-timing");
  await verifyPassword(dummy, pw);
}

/** Readable one-time password for new accounts (forced change at first login). */
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return "TOO_SHORT";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "NEEDS_LETTER_AND_DIGIT";
  return null;
}
