# WorkLog — Design & Phased Plan (v0.1, awaiting approval)

## 1. Key design decisions

| Area | Decision |
|---|---|
| Tenant isolation | Every tenant table has `tenantId`. App code never touches the raw Prisma client; it calls `db.forTenant(tenantId)` (a Prisma Client extension that injects `tenantId` into every `where` / `data` and rejects cross-tenant writes). An ESLint rule bans importing the raw client outside `src/server/db`. Postgres Row-Level Security is a defence-in-depth option for later. |
| Append-only log | `LogEntry`, `AuditEvent`, `DayCertification`, `LeaveLedger` are insert-only. Postgres triggers reject `UPDATE`/`DELETE` on them (in a migration), so even buggy code can't change history. A correction inserts a new entry with `supersedesId` → original, plus who/when/why. |
| Derived data | `DayRecord` (daily totals and flags) is a **cache** that can always be rebuilt from `LogEntry` + policy. Reports read it; it gets recomputed after every punch or correction. |
| Time | All `timestamptz` are stored in UTC. `Tenant.timezone` defaults to `Asia/Kolkata`. `workDate` is the tenant-local date of the shift's CHECK_IN, so night shifts that cross midnight stay on one day. `date-fns-tz` for conversion. |
| Status machine | `OFF → CHECK_IN(=ON_DUTY) ⇄ BREAK(Lunch/Tea/Personal) / FIELD_DUTY(note) → CHECK_OUT`. It's pure code with exhaustive tests. Work = ON_DUTY + FIELD; break time is shown separately and never auto-deducted. |
| Check-in gate | (a) The client IP must match one of the employee's office location CIDRs (`ipaddr.js`). `X-Forwarded-For` is trusted only for a configured number of proxy hops. (b) Device: a random 32-byte token in an httpOnly, Secure, SameSite=Strict cookie. Only its SHA-256 hash is stored, and it must be `APPROVED` by an admin. A failed check returns a clear reason and is written to the audit log. |
| Idle prompt | Client-side only. Mouse, key and focus *events* reset a timer, but **no content is captured**. `BroadcastChannel` syncs this across tabs. At the threshold (default 40 min) a modal asks "Were you on a break?". Yes: the employee picks a type and start time, and a back-dated BREAK entry is added with `source=IDLE_PROMPT`. No: nothing changes. |
| Webcam photo | Optional per tenant. The photo goes to S3-compatible storage (MinIO in Docker) with a configurable retention period (default 90 days), for DPDP data minimisation. |
| Auth | Auth.js v5 with Credentials (argon2 hashes) and JWT sessions carrying `userId, tenantId, role, employeeId`. RBAC guard helpers: `requireRole()` and `requireSameTeam()`. Login rate limiting. |
| Mutations | Server Actions with zod validation, calling `src/server/services/*`. The widget polls a small `GET /api/me/status` route. |
| i18n | `next-intl` without locale URL prefixes (locale stored in a cookie or user setting). All strings live in `messages/en.json`; `hi.json` comes later. |
| UI | Tailwind, shadcn/ui-style components, and `next-themes` for light/dark mode. |
| Background jobs | `pg-boss` (a Postgres-backed queue, so no Redis) in a separate `worker` process. It handles missed-checkout and uncertified-log alerts, nightly `DayRecord` recompute, and photo retention purges. |
| Tests | Vitest. Unit tests cover pure domain code; integration tests run against a real Postgres test container (tenant isolation, append-only triggers, services). Playwright smoke tests cover the main flows. |
| Reports | CSV via streaming. PDF via `@react-pdf/renderer`. |

## 2. Database schema (Prisma, condensed)

```prisma
// ─── Platform ───────────────────────────────────────────────
model Plan    { id String @id; name String; maxEmployees Int; features Json; priceMonthlyInr Int; tenants Tenant[] }
model Tenant  {
  id String @id @default(cuid()); name String; slug String @unique
  timezone String @default("Asia/Kolkata"); locale String @default("en")
  planId String; status TenantStatus @default(ACTIVE)          // ACTIVE | SUSPENDED
  requirePhotoAtCheckIn Boolean @default(false); idleTimeoutMin Int @default(40)
  photoRetentionDays Int @default(90); grievanceContact String?
  createdAt DateTime @default(now())
}

// ─── Identity ───────────────────────────────────────────────
model User {
  id String @id; tenantId String?            // null only for SUPER_ADMIN
  email String @unique; passwordHash String
  role Role                                   // SUPER_ADMIN | COMPANY_ADMIN | MANAGER | EMPLOYEE
  status UserStatus @default(ACTIVE); mustChangePassword Boolean @default(true)
  lastLoginAt DateTime?; employee Employee?
  @@index([tenantId])
}
model ConsentRecord { id String @id; tenantId String; userId String; noticeVersion String; acceptedAt DateTime; ip String? }  // append-only

// ─── Organisation ───────────────────────────────────────────
model Department     { id String @id; tenantId String; name String; @@unique([tenantId, name]) }
model OfficeLocation { id String @id; tenantId String; name String; address String?; cidrs String[]; active Boolean @default(true) }
model Employee {
  id String @id; tenantId String; userId String @unique
  employeeCode String; fullName String; designation String?
  departmentId String?; managerId String?     // self-relation → reporting manager
  officeLocationId String?; policyId String?  // null → tenant default policy
  joinedOn DateTime @db.Date; status EmployeeStatus @default(ACTIVE)
  @@unique([tenantId, employeeCode]); @@index([tenantId, managerId])
}
model Device {
  id String @id; tenantId String; employeeId String; label String
  tokenHash String @unique; userAgent String?
  status DeviceStatus @default(PENDING)       // PENDING | APPROVED | REJECTED | REVOKED
  requestedAt DateTime @default(now()); decidedById String?; decidedAt DateTime?
  lastSeenAt DateTime?; lastIp String?
  @@index([tenantId, employeeId])
}

// ─── Logbook (append-only) ──────────────────────────────────
model LogEntry {
  id String @id; tenantId String; employeeId String
  workDate DateTime @db.Date                  // tenant-local shift date
  type LogType                                // CHECK_IN | ON_DUTY | BREAK | FIELD_DUTY | CHECK_OUT | VOID
  breakKind BreakKind?                        // LUNCH | TEA | PERSONAL
  note String?
  occurredAt DateTime @db.Timestamptz         // when it happened (UTC)
  recordedAt DateTime @default(now()) @db.Timestamptz  // when it was written
  source EntrySource                          // SELF | IDLE_PROMPT | CORRECTION | SYSTEM
  createdById String                          // user who wrote it
  supersedesId String?                        // correction → original entry
  correctionRequestId String?
  ip String?; deviceId String?; photoKey String?
  @@index([tenantId, employeeId, workDate]); @@index([tenantId, workDate])
}
model DayRecord {                             // derived cache, rebuildable
  id String @id; tenantId String; employeeId String; workDate DateTime @db.Date
  state DayState                              // OPEN | CLOSED | CERTIFIED | ON_LEAVE | HOLIDAY | ABSENT
  firstInAt DateTime?; lastOutAt DateTime?
  workMin Int; breakMin Int; fieldMin Int; overtimeMin Int; lateMin Int
  flags String[]                              // rule violations, e.g. LATE, NO_BREAK, MAX_DAILY
  policyVersionId String?; computedAt DateTime
  @@unique([tenantId, employeeId, workDate])
}
model DayCertification {                      // append-only; re-certify after a correction
  id String @id; tenantId String; employeeId String; workDate DateTime @db.Date
  summary String @db.VarChar(500); logHash String  // hash of the effective entries at certification
  certifiedAt DateTime @default(now())
}
model AuditEvent {                            // append-only
  id String @id; tenantId String?; actorUserId String?; subjectEmployeeId String?
  action String                               // e.g. "log.check_in", "device.approve", "checkin.denied_ip"
  entityType String; entityId String?; before Json?; after Json?; reason String?
  ip String?; createdAt DateTime @default(now())
  @@index([tenantId, subjectEmployeeId, createdAt])
}

// ─── Phase 2: requests ──────────────────────────────────────
model LeaveType   { id String @id; tenantId String; code String; name String; yearlyQuota Decimal; paid Boolean; carryForwardMax Decimal @default(0); halfDayAllowed Boolean @default(true); active Boolean; @@unique([tenantId, code]) }
model LeaveLedger { id String @id; tenantId String; employeeId String; leaveTypeId String; year Int
                    kind LedgerKind /* ALLOCATION | DEBIT | REVERSAL | ADJUSTMENT | CARRY_FORWARD */; days Decimal
                    leaveRequestId String?; createdById String; reason String?; createdAt DateTime }   // balance = SUM(days); append-only
model LeaveRequest      { id String @id; tenantId String; employeeId String; leaveTypeId String; startDate DateTime @db.Date; endDate DateTime @db.Date
                          startHalf Boolean; endHalf Boolean; days Decimal; reason String; ...Decision }
model CorrectionRequest { id String @id; tenantId String; employeeId String; workDate DateTime @db.Date
                          kind CorrectionKind /* MISSED_CHECK_IN | MISSED_CHECK_OUT | WRONG_TIME | MISSED_BREAK | REMOVE_ENTRY */
                          targetEntryId String?; proposed Json /* [{type, occurredAt, breakKind?}] */; reason String; ...Decision }
model OvertimeRequest   { id String @id; tenantId String; employeeId String; workDate DateTime @db.Date; minutes Int; reason String; ...Decision }
// ...Decision = status RequestStatus (PENDING|APPROVED|REJECTED|CANCELLED), approverId String?, decidedAt DateTime?, decisionComment String?, createdAt

// ─── Phase 3: rules, calendar, alerts ───────────────────────
model Policy        { id String @id; tenantId String; name String; isDefault Boolean; versions PolicyVersion[] }
model PolicyVersion {                          // immutable; history is evaluated with the rules in force at the time
  id String @id; tenantId String; policyId String; effectiveFrom DateTime @db.Date
  shiftStart String /* "09:30" */; shiftEnd String; workDays Int[] /* 1=Mon..7 */
  graceMin Int; maxDailyMin Int; maxWeeklyMin Int
  mandatoryBreakAfterMin Int?; minBreakMin Int?; overtimeCapMonthlyMin Int?
  halfDayMinWorkMin Int?; createdById String; createdAt DateTime
}
model Holiday { id String @id; tenantId String; date DateTime @db.Date; name String; officeLocationId String?; optional Boolean @default(false) }
model Alert   { id String @id; tenantId String; employeeId String; workDate DateTime @db.Date
                type AlertType /* LATE_ARRIVAL | MISSED_CHECKOUT | OVERTIME_LIMIT | UNCERTIFIED_LOG | NO_BREAK | MAX_DAILY | MAX_WEEKLY */
                details Json; createdAt DateTime; acknowledgedById String?; acknowledgedAt DateTime?
                @@unique([tenantId, employeeId, workDate, type]) }
model DataExport { id String @id; tenantId String; userId String; status String; fileKey String?; requestedAt DateTime; readyAt DateTime? }
```

Every model listed after `Plan`/`Tenant` has a `tenant` relation and a `tenantId` index. The scoped-client extension keeps a list of these models (it fails closed for any model not on the list).

## 3. Folder structure

```
.
├── docker-compose.yml        # db, db-test, minio, mailpit, app, worker
├── Dockerfile
├── prisma/
│   ├── schema.prisma
│   ├── migrations/           # includes append-only trigger SQL
│   └── seed.ts               # 1 company, 1 admin, 2 managers, 10 employees + history
├── messages/en.json          # (hi.json later)
├── src/
│   ├── app/
│   │   ├── (auth)/login, consent, change-password
│   │   ├── (app)/            # shell + floating status widget
│   │   │   ├── dashboard/    # punch panel
│   │   │   ├── logs/ logs/[date]/        # My Logs calendar + day detail/audit
│   │   │   ├── leave/ requests/ privacy/ # self-service, data export
│   │   │   ├── team/ approvals/ alerts/ reports/          # manager
│   │   │   └── admin/{employees,departments,locations,devices,policies,leave-types,holidays,reports,settings}
│   │   ├── super/{tenants,plans}
│   │   └── api/{auth/[...nextauth], me/status, exports/*, photos/*}
│   ├── domain/               # PURE TS, no I/O: timeline state machine, hours calc,
│   │                         # rules engine, leave-day counting, tz helpers, CIDR match
│   ├── server/
│   │   ├── db/               # prisma client + forTenant() extension
│   │   ├── auth/             # Auth.js config, RBAC guards
│   │   ├── services/         # attendance, devices, leave, corrections, overtime, audit, policy, alerts, reports, privacy
│   │   └── security/         # client IP resolution, device tokens, rate limit
│   ├── worker/               # pg-boss jobs
│   ├── components/{ui,status-widget,calendar,tables}
│   └── i18n/
└── tests/{unit,integration,e2e}
```

## 4. Phases

**Phase 1: Foundation and punching**
- Docker, Next.js, Prisma, Tailwind, light/dark mode, i18n scaffold, and the scoped DB client with append-only triggers
- Auth with 4 roles, first-login password change, and a DPDP consent notice (versioned, recorded)
- Super Admin: tenant and plan CRUD. Company Admin: employees (single add plus CSV import), departments, managers, office locations and CIDRs
- Device registration request → admin approval → device cookie
- Check In / Break / Field / Check Out with IP and device gates, optional webcam photo, and audit events
- Floating status widget (live timer, today's work and break totals), idle prompt, and a check-out reminder on tab close or logout
- Day summary and certification
- My Logs calendar, plus day detail showing every raw entry and the audit trail
- Tests: state machine, hours calculation (including midnight crossings, open days, tz), CIDR matching, tenant isolation, append-only enforcement

**Phase 2: Requests and approvals**
- Leave types and quotas, ledger-based balances, applying for leave (half days, skipping weekends and holidays), cancelling
- Correction requests (approval creates superseding entries, recomputes the day, and needs re-certification) and overtime requests
- Manager approval queue with comments, and a live team board (On Duty / Break / Field / Off / On Leave)
- Full audit trail views for employees and admins, and a personal data export (JSON + CSV zip)
- Tests: leave-day counting, balance ledger, correction supersede logic, approval RBAC (a manager sees only their reports), isolation

**Phase 3: Rules, alerts, reports**
- Versioned policy rules engine (shift, grace, daily and weekly max, mandatory break, OT cap, half day) and holiday calendar
- Rule evaluation feeds `DayRecord.flags`. Worker alerts cover late arrival, missed checkout, OT cap crossed, and uncertified logs
- Manager team reports (CSV), admin monthly attendance and timesheet reports (CSV + PDF), and tenant settings (photo, idle timeout, retention, grievance contact)
- Tests: every rule violation, policy-version selection by date, alert idempotency, report totals matching `DayRecord`

After each phase: seed data, run tests, report the results, and write "how to run locally" (`docker compose up`, `npm run db:migrate && npm run db:seed`, `npm run dev`, `npm test`).

## 5. Open questions
1. **Login identity**: a globally unique email (simplest), or company code + email/employee ID (allows the same email in two tenants and suits government staff without corporate email)?
2. **Tenant addressing**: one domain with the tenant taken from the login (proposed), or per-tenant subdomains (`acme.worklog.app`)?
3. **Webcam photo storage**: MinIO/S3 as proposed, or store in Postgres for now to keep Docker simpler?
4. **Week start and work week** defaults: Mon–Fri, or Mon–Sat (common in Indian government)? Proposed: configurable per policy, defaulting to Mon–Sat with 2nd/4th Saturdays off as a holiday rule? (Or keep it simple at Mon–Fri.)
