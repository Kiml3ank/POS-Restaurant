-- CreateEnum
CREATE TYPE "SalePointKind" AS ENUM ('DINE_IN', 'COUNTER', 'DELIVERY');

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'DELIVERY';

-- AlterTable
ALTER TABLE "restaurant_tables" ADD COLUMN     "kind" "SalePointKind" NOT NULL DEFAULT 'DINE_IN';

-- AlterTable
ALTER TABLE "table_sessions" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "queueDay" TEXT,
ADD COLUMN     "queueNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "table_sessions_branchId_queueDay_queueNumber_key" ON "table_sessions"("branchId", "queueDay", "queueNumber");

