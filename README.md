# WorkLog

A self-service digital work logbook for corporate and government employees, modelled on trucking ELD logbooks. Employees mark their own attendance, breaks and field duty from their office computer. Managers monitor, and company admins configure. It's multi-tenant and sold to many companies.

> Status: **Phase 2 + pilot-readiness batch done**. The readiness batch added email and in-app notifications, password reset by email, approver cover and escalation, company settings, field check-out, and a committed end-to-end suite. Phase 1 covered auth, tenants, employees, check-in/break/field/check-out with IP + device checks, the status widget, idle prompt, day certification and My Logs. Phase 2 adds leave (ledger-based balances), corrections, overtime, the manager approval queue, a live team board, the company audit log, and a ZIP data export. See [docs/PLAN.md](docs/PLAN.md) for the full plan.

## Run it locally

### Option A: everything in Docker

```bash
docker compose up
```

This starts Postgres (dev on :5432, a RAM-only test DB on :5433), applies migrations, seeds demo data on first run, and serves the app at http://localhost:3000. Every email the app sends (notifications, password resets) lands in **Mailpit** at http://localhost:8025.

### Option B: databases in Docker, app on your machine (faster reloads)

```bash
cp .env.example .env            # then set AUTH_SECRET: openssl rand -base64 32
docker compose up -d db db-test
npm install
npm run db:migrate              # applies migrations (incl. append-only triggers)
npm run db:seed                 # demo company with ~4 weeks of history; safe to re-run (adds missing phases only)
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

- `manager1@acme.test` → **Approvals**: pending leave, overtime, and `emp03`'s correction adding the missing check-out.
- `admin@acme.test` → **Approvals**: `manager1`'s own leave (managers can't approve their own requests).
- `manager2@acme.test` → **Team board**: people on duty, on break, on field duty, and one on sick leave today.
- `emp07` has a day corrected and approved. Open it in My logs: the original check-in is struck through and the correction is listed.
- `emp01`: open a past day and choose **Request a correction**.
- `emp02`: **Leave** shows balances; the apply form previews how many days a request uses.
- Several days are waiting for a summary.

### Tests

```bash
npm test                    # everything
npm run test:unit           # pure logic: hours, status machine, tz, CIDR, CSV, leave-day counting, correction simulation
npm run test:integration    # against DATABASE_URL_TEST: tenant isolation, append-only, punch flows, leave ledger, approvals, corrections
```

Integration tests only *apply* migrations to the test DB (never reset it). Each test creates its own uniquely named tenants, which also exercises isolation. The setup refuses to run against a database URL that doesn't contain `test`.

End-to-end (Playwright, against a production build and the test database):

```bash
npm run build
npm run test:e2e            # 7 browser flows; each run creates its own fresh tenants
```

They cover first sign-in (forced password change and privacy notice), forgot password, the device gate (register, approve, punch a full day, certify), check-in from outside the office being refused, leave approval with notifications, approver cover, and cross-tenant URL guessing. CI runs everything: lint, types, unit, integration, build and e2e.

Also: `npm run lint`, `npm run typecheck`, `npm run build`.

## How it's built

| Concern | Where / how |
|---|---|
| Tenant isolation | Composite `(tenantId, id)` foreign keys, so Postgres rejects cross-tenant references. `forTenant()` (`src/server/db/tenant.ts`) is a Prisma extension that ANDs `tenantId` into every query, stamps creates, blocks nested relation writes, and fails closed for unknown models. ESLint forbids importing the unscoped client outside an allow-list. |
| Append-only history | Postgres triggers reject `UPDATE`/`DELETE` on `LogEntry`, `AuditEvent`, `DayCertification`, `ConsentRecord`, `LeaveLedger`. An approved correction inserts new `LogEntry` rows (source `CORRECTION`) that point at the originals via `supersedesId`, and a removal is a `VOID` row. |
| Leave balances | `LeaveLedger` is append-only and the balance is `SUM(days)`: allocations, debits on approval, reversals on cancellation, and admin adjustments. Pending requests reserve days. Days are counted in `src/domain/leave.ts`, which skips weekly offs (tenant setting) and, from Phase 3, holidays. |
| Approvals | `src/server/services/approval-rights.ts`: the requester's direct manager or a company admin decides. Nobody decides their own request, except a company admin who reports to no one (audited as self-approval). Rejections need a comment. |
| Corrections | The employee edits a copy of the day. `simulateCorrection()` (`src/domain/corrections.ts`) checks the result is a valid, closed day when it's requested **and again** at approval, in case the day changed meanwhile. |
| Hours calculation | Pure functions in `src/domain/` (`timeline.ts`, `status-machine.ts`). `DayRecord` is a rebuildable cache. A missed check-out is never auto-closed: the open stretch counts as zero until corrected. |
| Check-in gate | `checkGate()` in `src/server/services/attendance.ts` checks the office CIDR (`src/domain/cidr.ts`) and an approved device. The device token is an httpOnly cookie, and only its SHA-256 is stored. Denials are audited. |
| Client IP | `src/server/security/client-ip.ts`: trusts only the right-most `TRUST_PROXY_HOPS` entries of `X-Forwarded-For`. Use `1` for `next dev`/`next start` with no proxy and `2` behind one reverse proxy. **Set this correctly in production**, or the IP check can be spoofed. |
| Time | Stored as UTC `timestamptz`; shown in the tenant's zone (default `Asia/Kolkata`). A shift belongs to the local date of its check-in, so night shifts stay on one day. |
| Idle prompt | `src/components/status/status-provider.tsx` notices *that* the tab had input (never what), syncs across tabs, and asks. It never deducts time. |
| Privacy (DPDP Act 2023) | Versioned consent notice at first sign-in (recorded with time and IP). **My data** lists what is and isn't recorded, shows the full audit trail, and offers a JSON download. Photo views by others are audited. |
| Notifications | `src/server/services/notifications.ts`. In-app rows are written inside the action's transaction. Emails go through an outbox (`EmailMessage`) and are sent only after commit, so a failed action never emails anyone; failed sends are retried. Text comes from `messages/en.json` → `notifications.*`, so it's ready for translation. |
| Sessions | JWTs carry the user's `authVersion`. Changing or resetting a password, or deactivating a user or changing their role, bumps it and signs out every existing session. |
| Background sweep | `src/server/jobs/` runs every 15 minutes in-process, with a Postgres advisory lock so only one instance runs it. It escalates stale requests (and those whose approver is on leave without cover), marks never-closed days as missed check-outs, and retries emails. For serverless, set `DISABLE_SCHEDULER=1` and call `POST /api/cron/sweep` with `Authorization: Bearer $CRON_SECRET`. |
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
- There are no holidays yet, so leave counting skips only weekly offs. The holiday calendar, the overtime cap and the other rules arrive with the Phase 3 rules engine.
- Yearly quotas aren't pro-rated for mid-year joiners; use **Adjust a balance**. Carry-forward is also a manual adjustment for now.
- No email notifications yet. Approvers see the count badge and the queue. Alerts are Phase 3.
