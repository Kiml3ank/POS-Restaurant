-- CreateEnum
CREATE TYPE "StaffScreenKind" AS ENUM ('POS', 'KDS', 'ADMIN');

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "screen" "StaffScreenKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByStaffId" TEXT,
    "revokedReason" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_login_throttle" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffCode" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_login_throttle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_sessions_staffId_revokedAt_idx" ON "staff_sessions"("staffId", "revokedAt");

-- CreateIndex
CREATE INDEX "staff_sessions_branchId_createdAt_idx" ON "staff_sessions"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "staff_sessions_expiresAt_idx" ON "staff_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_login_throttle_branchId_staffCode_key" ON "staff_login_throttle"("branchId", "staffCode");

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_revokedByStaffId_fkey" FOREIGN KEY ("revokedByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_login_throttle" ADD CONSTRAINT "staff_login_throttle_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
