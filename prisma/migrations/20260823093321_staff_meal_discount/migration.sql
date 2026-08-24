-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "staffMealDiscountBp" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "discountBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "staffCustomerId" TEXT;

-- AlterTable
ALTER TABLE "table_sessions" ADD COLUMN     "staffCustomerId" TEXT,
ADD COLUMN     "staffMealSetAt" TIMESTAMP(3),
ADD COLUMN     "staffMealSetById" TEXT;

-- CreateIndex
CREATE INDEX "payments_staffCustomerId_idx" ON "payments"("staffCustomerId");

-- CreateIndex
CREATE INDEX "table_sessions_staffCustomerId_status_idx" ON "table_sessions"("staffCustomerId", "status");

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_staffCustomerId_fkey" FOREIGN KEY ("staffCustomerId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_staffMealSetById_fkey" FOREIGN KEY ("staffMealSetById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_staffCustomerId_fkey" FOREIGN KEY ("staffCustomerId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
