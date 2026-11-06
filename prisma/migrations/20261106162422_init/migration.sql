-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('CHECK_IN', 'ON_DUTY', 'BREAK', 'FIELD_DUTY', 'CHECK_OUT', 'VOID');

-- CreateEnum
CREATE TYPE "BreakKind" AS ENUM ('LUNCH', 'TEA', 'PERSONAL');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('SELF', 'IDLE_PROMPT', 'CORRECTION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DayState" AS ENUM ('OPEN', 'CLOSED', 'CERTIFIED', 'MISSED_CHECKOUT');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxEmployees" INTEGER NOT NULL,
    "priceMonthlyInr" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "planId" TEXT NOT NULL,
    "requirePhotoAtCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "idleTimeoutMin" INTEGER NOT NULL DEFAULT 40,
    "photoRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "grievanceContact" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "cidrs" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OfficeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "designation" TEXT,
    "departmentId" TEXT,
    "managerId" TEXT,
    "officeLocationId" TEXT,
    "joinedOn" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "requestIp" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3),
    "lastIp" TEXT,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "type" "LogType" NOT NULL,
    "breakKind" "BreakKind",
    "note" VARCHAR(500),
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "EntrySource" NOT NULL,
    "createdById" TEXT NOT NULL,
    "supersedesId" TEXT,
    "correctionRequestId" TEXT,
    "ip" TEXT,
    "deviceId" TEXT,
    "photoKey" TEXT,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "state" "DayState" NOT NULL,
    "firstInAt" TIMESTAMPTZ(3),
    "lastOutAt" TIMESTAMPTZ(3),
    "workMin" INTEGER NOT NULL DEFAULT 0,
    "breakMin" INTEGER NOT NULL DEFAULT 0,
    "fieldMin" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[],
    "computedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DayRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayCertification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "logHash" TEXT NOT NULL,
    "certifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorUserId" TEXT,
    "subjectEmployeeId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ConsentRecord_tenantId_userId_idx" ON "ConsentRecord"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_id_key" ON "Department"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_name_key" ON "Department"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeLocation_tenantId_id_key" ON "OfficeLocation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeLocation_tenantId_name_key" ON "OfficeLocation"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_tenantId_managerId_idx" ON "Employee"("tenantId", "managerId");

-- CreateIndex
CREATE INDEX "Employee_tenantId_departmentId_idx" ON "Employee"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_id_key" ON "Employee"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_userId_key" ON "Employee"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_employeeCode_key" ON "Employee"("tenantId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_tenantId_status_idx" ON "Device"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Device_tenantId_employeeId_idx" ON "Device"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tenantId_id_key" ON "Device"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LogEntry_tenantId_employeeId_workDate_idx" ON "LogEntry"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "LogEntry_tenantId_employeeId_occurredAt_idx" ON "LogEntry"("tenantId", "employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "LogEntry_tenantId_workDate_idx" ON "LogEntry"("tenantId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "LogEntry_tenantId_id_key" ON "LogEntry"("tenantId", "id");

-- CreateIndex
CREATE INDEX "DayRecord_tenantId_workDate_idx" ON "DayRecord"("tenantId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "DayRecord_tenantId_employeeId_workDate_key" ON "DayRecord"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "DayCertification_tenantId_employeeId_workDate_idx" ON "DayCertification"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_subjectEmployeeId_createdAt_idx" ON "AuditEvent"("tenantId", "subjectEmployeeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeLocation" ADD CONSTRAINT "OfficeLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_departmentId_fkey" FOREIGN KEY ("tenantId", "departmentId") REFERENCES "Department"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_managerId_fkey" FOREIGN KEY ("tenantId", "managerId") REFERENCES "Employee"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_officeLocationId_fkey" FOREIGN KEY ("tenantId", "officeLocationId") REFERENCES "OfficeLocation"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_tenantId_supersedesId_fkey" FOREIGN KEY ("tenantId", "supersedesId") REFERENCES "LogEntry"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_tenantId_deviceId_fkey" FOREIGN KEY ("tenantId", "deviceId") REFERENCES "Device"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DayRecord" ADD CONSTRAINT "DayRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayRecord" ADD CONSTRAINT "DayRecord_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DayCertification" ADD CONSTRAINT "DayCertification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCertification" ADD CONSTRAINT "DayCertification_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────── WorkLog: integrity rules ─────────────────────────

-- Append-only tables: history is never edited or deleted. Corrections insert new rows.
CREATE OR REPLACE FUNCTION worklog_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WORKLOG_APPEND_ONLY: % on "%" is not allowed; insert a correcting row instead', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_entry_append_only BEFORE UPDATE OR DELETE ON "LogEntry"
  FOR EACH ROW EXECUTE FUNCTION worklog_forbid_mutation();
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION worklog_forbid_mutation();
CREATE TRIGGER day_certification_append_only BEFORE UPDATE OR DELETE ON "DayCertification"
  FOR EACH ROW EXECUTE FUNCTION worklog_forbid_mutation();
CREATE TRIGGER consent_record_append_only BEFORE UPDATE OR DELETE ON "ConsentRecord"
  FOR EACH ROW EXECUTE FUNCTION worklog_forbid_mutation();

-- Only the platform super admin lives outside a tenant.
ALTER TABLE "User" ADD CONSTRAINT user_tenant_role_chk
  CHECK ((role = 'SUPER_ADMIN') = ("tenantId" IS NULL));

-- Break kind is required for (and only for) BREAK entries.
ALTER TABLE "LogEntry" ADD CONSTRAINT log_entry_break_kind_chk
  CHECK ((type = 'BREAK') = ("breakKind" IS NOT NULL));

-- A correction must point at the row it replaces; VOID only exists as a correction.
ALTER TABLE "LogEntry" ADD CONSTRAINT log_entry_void_chk
  CHECK (type <> 'VOID' OR "supersedesId" IS NOT NULL);

ALTER TABLE "Employee" ADD CONSTRAINT employee_not_own_manager_chk
  CHECK ("managerId" IS NULL OR "managerId" <> id);
