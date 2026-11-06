-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('ALLOCATION', 'DEBIT', 'REVERSAL', 'ADJUSTMENT', 'CARRY_FORWARD');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "weeklyOffDays" INTEGER[] DEFAULT ARRAY[6, 7]::INTEGER[];

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yearlyQuota" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "tracksBalance" BOOLEAN NOT NULL DEFAULT true,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "halfDayAllowed" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "leaveRequestId" TEXT,
    "createdById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDayStart" BOOLEAN NOT NULL DEFAULT false,
    "halfDayEnd" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionComment" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "ops" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionComment" VARCHAR(500),
    "appliedEntryIds" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionComment" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenantId_id_key" ON "LeaveType"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_tenantId_code_key" ON "LeaveType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "LeaveLedger_tenantId_employeeId_year_idx" ON "LeaveLedger"("tenantId", "employeeId", "year");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_employeeId_startDate_idx" ON "LeaveRequest"("tenantId", "employeeId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_status_idx" ON "LeaveRequest"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_tenantId_id_key" ON "LeaveRequest"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CorrectionRequest_tenantId_employeeId_workDate_idx" ON "CorrectionRequest"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "CorrectionRequest_tenantId_status_idx" ON "CorrectionRequest"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionRequest_tenantId_id_key" ON "CorrectionRequest"("tenantId", "id");

-- CreateIndex
CREATE INDEX "OvertimeRequest_tenantId_employeeId_workDate_idx" ON "OvertimeRequest"("tenantId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "OvertimeRequest_tenantId_status_idx" ON "OvertimeRequest"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeRequest_tenantId_id_key" ON "OvertimeRequest"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedger" ADD CONSTRAINT "LeaveLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedger" ADD CONSTRAINT "LeaveLedger_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeaveLedger" ADD CONSTRAINT "LeaveLedger_tenantId_leaveTypeId_fkey" FOREIGN KEY ("tenantId", "leaveTypeId") REFERENCES "LeaveType"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeaveLedger" ADD CONSTRAINT "LeaveLedger_tenantId_leaveRequestId_fkey" FOREIGN KEY ("tenantId", "leaveRequestId") REFERENCES "LeaveRequest"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_leaveTypeId_fkey" FOREIGN KEY ("tenantId", "leaveTypeId") REFERENCES "LeaveType"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ───────────────────────── WorkLog: Phase 2 integrity rules ─────────────────────────

-- The leave ledger is append-only: balances are always the sum of history.
CREATE TRIGGER leave_ledger_append_only BEFORE UPDATE OR DELETE ON "LeaveLedger"
  FOR EACH ROW EXECUTE FUNCTION worklog_forbid_mutation();

ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_request_dates_chk CHECK ("endDate" >= "startDate");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_request_days_chk CHECK ("days" > 0);
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_request_half_chk
  CHECK (NOT ("startDate" = "endDate" AND "halfDayStart" AND "halfDayEnd"));
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT overtime_minutes_chk CHECK ("minutes" BETWEEN 1 AND 1440);
ALTER TABLE "LeaveType" ADD CONSTRAINT leave_type_quota_chk CHECK ("yearlyQuota" >= 0);

-- Decided requests must say who decided and when.
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_request_decided_chk
  CHECK (status IN ('PENDING', 'CANCELLED') OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT correction_request_decided_chk
  CHECK (status IN ('PENDING', 'CANCELLED') OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT overtime_request_decided_chk
  CHECK (status IN ('PENDING', 'CANCELLED') OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL));

-- At most one open correction per employee per day.
CREATE UNIQUE INDEX correction_one_pending_per_day ON "CorrectionRequest" ("tenantId", "employeeId", "workDate") WHERE status = 'PENDING';
