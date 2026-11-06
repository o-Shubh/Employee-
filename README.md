# WorkLog

A self-service digital work logbook for corporate and government employees, modelled on trucking ELD logbooks. Employees mark their own attendance, breaks and field duty from their office computer. Managers monitor, and company admins configure. It's multi-tenant and sold to many companies.

> Status: **Phase 1 done**: auth, tenants, employees, check-in/break/field/check-out with IP + device checks, status widget, idle prompt, day certification, My Logs. See [docs/PLAN.md](docs/PLAN.md) for the full plan.

## Run it locally

### Option A: everything in Docker

```bash
docker compose up
```

This starts Postgres (dev on :5432, a RAM-only test DB on :5433), applies migrations, seeds demo data on first run, and serves the app at http://localhost:3000.

### Option B: databases in Docker, app on your machine (faster reloads)

```bash
cp .env.example .env            # then set AUTH_SECRET: openssl rand -base64 32
docker compose up -d db db-test
npm install
npm run db:migrate              # applies migrations (incl. append-only triggers)
npm run db:seed                 # demo company with ~4 weeks of history
npm run dev                     # http://localhost:3000
```

### Demo accounts

All accounts use the password `WorkLog@2026`. Each person sees the privacy notice at first sign-in.

| Email | Role |
|---|---|
| `super@worklog.local` | Platform super admin (you, the vendor) |
| `admin@acme.test` | Company admin, Priya Nair |
| `manager1@acme.test` | Manager, Engineering (Rohan Mehta, 5 reports) |
| `manager2@acme.test` | Manager, Operations (Sunita Rao, 5 reports) |
| `emp01@acme.test` … `emp10@acme.test` | Employees |

**First check-in from your browser:** the seed gives every employee an approved computer, but the token for it lives only in the database. Your browser needs its own:

1. Sign in as an employee and open **This computer**. Register it.
2. Sign in as `admin@acme.test` (in another browser or a private window) and open **Computers**. Approve it.
3. Back as the employee, **Check in**.

The seeded office network allows loopback and private LAN ranges, so localhost works. Some things to look at:

- `emp03` has a day with no check-out in October, under My logs.
- Six employees are live right now on the managers' **Team today**.
- Several days are waiting for a summary.

### Tests

```bash
npm test                    # everything
npm run test:unit           # pure logic: hours, status machine, tz, CIDR, CSV
npm run test:integration    # against DATABASE_URL_TEST: tenant isolation, append-only, punch flows
```

Integration tests only *apply* migrations to the test DB (never reset it). Each test creates its own uniquely named tenants, which also exercises isolation. The setup refuses to run against a database URL that doesn't contain `test`.

Also: `npm run lint`, `npm run typecheck`, `npm run build`.

## How it's built

| Concern | Where / how |
|---|---|
| Tenant isolation | Composite `(tenantId, id)` foreign keys, so Postgres rejects cross-tenant references. `forTenant()` (`src/server/db/tenant.ts`) is a Prisma extension that ANDs `tenantId` into every query, stamps creates, blocks nested relation writes, and fails closed for unknown models. ESLint forbids importing the unscoped client outside an allow-list. |
| Append-only history | Postgres triggers reject `UPDATE`/`DELETE` on `LogEntry`, `AuditEvent`, `DayCertification`, `ConsentRecord`. Corrections (Phase 2) insert new rows with `supersedesId`. |
| Hours calculation | Pure functions in `src/domain/` (`timeline.ts`, `status-machine.ts`). `DayRecord` is a rebuildable cache. A missed check-out is never auto-closed: the open stretch counts as zero until corrected. |
| Check-in gate | `checkGate()` in `src/server/services/attendance.ts` checks the office CIDR (`src/domain/cidr.ts`) and an approved device. The device token is an httpOnly cookie, and only its SHA-256 is stored. Denials are audited. |
| Client IP | `src/server/security/client-ip.ts`: trusts only the right-most `TRUST_PROXY_HOPS` entries of `X-Forwarded-For`. Use `1` for `next dev`/`next start` with no proxy and `2` behind one reverse proxy. **Set this correctly in production**, or the IP check can be spoofed. |
| Time | Stored as UTC `timestamptz`; shown in the tenant's zone (default `Asia/Kolkata`). A shift belongs to the local date of its check-in, so night shifts stay on one day. |
| Idle prompt | `src/components/status/status-provider.tsx` notices *that* the tab had input (never what), syncs across tabs, and asks. It never deducts time. |
| Privacy (DPDP Act 2023) | Versioned consent notice at first sign-in (recorded with time and IP). **My data** lists what is and isn't recorded, shows the full audit trail, and offers a JSON download. Photo views by others are audited. |
| i18n | `next-intl`, all strings in `messages/en.json`. To add Hindi, create `messages/hi.json` and add `"hi"` to `LOCALES` in `src/i18n/request.ts`. |

```
prisma/            schema, migrations (incl. trigger SQL), seed
src/domain/        pure logic, no I/O
src/server/        db scoping, auth, services, security, storage
src/app/           routes: (auth), (app) [employee/manager/admin], super, api
src/components/    UI, status widget, duty graph
tests/unit, tests/integration
```

## Known limits in Phase 1

- Check-in photos use a local-disk storage driver (`STORAGE_DIR`). An S3/MinIO driver and photo retention purging come in Phase 3.
- Login rate limiting is in-memory, so it's per app instance.
- A missed check-out can only be fixed through the correction request flow (Phase 2).
- Leave, corrections, overtime and the approval queue are Phase 2. The rules engine, alerts and reports are Phase 3.
