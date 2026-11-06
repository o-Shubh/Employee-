import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * The UNSCOPED client. Only auth (email lookup before we know the tenant),
 * the super-admin service, seeding and tests may use it directly — enforced by
 * ESLint `no-restricted-imports`. Everything else goes through `forTenant()`.
 */
const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prismaUnscoped: PrismaClient = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = prismaUnscoped;
