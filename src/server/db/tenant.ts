import type { PrismaClient } from "@prisma/client";

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(`TENANT_SCOPE: ${message}`);
    this.name = "TenantScopeError";
  }
}

/** Models that carry tenantId and are filtered automatically. */
export const TENANT_MODELS = new Set([
  "User",
  "ConsentRecord",
  "Department",
  "OfficeLocation",
  "Employee",
  "Device",
  "LogEntry",
  "DayRecord",
  "DayCertification",
  "AuditEvent",
  "LeaveType",
  "LeaveLedger",
  "LeaveRequest",
  "CorrectionRequest",
  "OvertimeRequest",
  "Notification",
  "ApproverDelegation",
]);
/** Global reference data tenants may read but never write. */
const READ_ONLY_GLOBAL = new Set(["Plan"]);
const READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
]);
const NESTED_WRITE_KEYS = ["create", "connect", "connectOrCreate", "createMany", "upsert", "disconnect", "delete", "deleteMany", "update", "updateMany"];
const JSON_FIELDS = new Set(["before", "after", "features"]);

type Args = Record<string, unknown> & { where?: unknown; data?: unknown; create?: unknown; update?: unknown };

/**
 * Returns a Prisma client that can only see and write rows of `tenantId`.
 *
 *  - reads / updates / deletes get `tenantId` AND-ed into `where`
 *  - creates get `tenantId` injected; a different tenantId throws
 *  - relation-object writes (nested create/connect) are rejected, so every write
 *    passes through this filter (composite FKs make included relations safe to read)
 *  - unknown models fail closed
 */
export function forTenant(tenantId: string, base: PrismaClient) {
  if (!tenantId || typeof tenantId !== "string") throw new TenantScopeError("missing tenantId");

  const scopeWhere = (where: unknown) => (where ? { AND: [where, { tenantId }] } : { tenantId });
  const scopeUnique = (where: unknown) => ({ ...(where as object), tenantId });

  const guardData = (model: string, data: unknown, isCreate: boolean): Record<string, unknown> => {
    if (!data || typeof data !== "object") throw new TenantScopeError(`${model}: missing data`);
    const d = { ...(data as Record<string, unknown>) };
    if ("tenant" in d) throw new TenantScopeError(`${model}: use tenant-less unchecked input`);
    for (const [k, v] of Object.entries(d)) {
      if (JSON_FIELDS.has(k) || !v || typeof v !== "object" || Array.isArray(v) || v instanceof Date) continue;
      if (NESTED_WRITE_KEYS.some((nk) => nk in (v as object))) {
        throw new TenantScopeError(`${model}.${k}: nested relation writes are not allowed`);
      }
    }
    if ("tenantId" in d && d.tenantId !== tenantId) {
      throw new TenantScopeError(`${model}: attempted to write tenantId ${String(d.tenantId)}`);
    }
    if (isCreate) d.tenantId = tenantId;
    return d;
  };

  return base.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a: Args = { ...((args ?? {}) as Args) };

          if (model === "Tenant") {
            // A tenant can see and update only itself.
            if (operation === "findUnique" || operation === "findUniqueOrThrow" || operation === "update") {
              a.where = { ...(a.where as object), id: tenantId };
            } else if (READ_OPS.has(operation)) {
              a.where = a.where ? { AND: [a.where, { id: tenantId }] } : { id: tenantId };
            } else throw new TenantScopeError(`Tenant.${operation} not allowed`);
            if (operation === "update") {
              const data = a.data as Record<string, unknown>;
              for (const k of ["id", "planId", "status", "slug"]) {
                if (k in data) throw new TenantScopeError(`Tenant.${k} is managed by the platform`);
              }
            }
            return query(a as typeof args);
          }

          if (READ_ONLY_GLOBAL.has(model)) {
            if (!READ_OPS.has(operation)) throw new TenantScopeError(`${model}.${operation} not allowed`);
            return query(args);
          }

          if (!TENANT_MODELS.has(model)) throw new TenantScopeError(`model ${model} is not tenant-registered`);

          switch (operation) {
            case "create":
              a.data = guardData(model, a.data, true);
              break;
            case "createMany":
            case "createManyAndReturn":
              a.data = Array.isArray(a.data)
                ? a.data.map((d) => guardData(model, d, true))
                : guardData(model, a.data, true);
              break;
            case "upsert":
              a.where = scopeUnique(a.where);
              a.create = guardData(model, a.create, true);
              a.update = guardData(model, a.update, false);
              break;
            case "update":
              a.where = scopeUnique(a.where);
              a.data = guardData(model, a.data, false);
              break;
            case "updateMany":
            case "updateManyAndReturn":
              a.where = scopeWhere(a.where);
              a.data = guardData(model, a.data, false);
              break;
            case "findUnique":
            case "findUniqueOrThrow":
            case "delete":
              a.where = scopeUnique(a.where);
              break;
            default:
              // findFirst(OrThrow), findMany, count, aggregate, groupBy, deleteMany
              a.where = scopeWhere(a.where);
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forTenant>;
/** The client available inside `db.$transaction(async (tx) => ...)`. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
export type TenantClient = TenantDb | TenantTx;
