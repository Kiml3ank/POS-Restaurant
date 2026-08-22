-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QR', 'CARD');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentId" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "currency" "Currency" NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "serviceChargeAmount" INTEGER NOT NULL,
    "vatAmount" INTEGER NOT NULL,
    "netAmount" INTEGER NOT NULL,
    "grandTotal" INTEGER NOT NULL,
    "receivedAmount" INTEGER,
    "changeAmount" INTEGER,
    "serviceChargeBp" INTEGER NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "pricesIncludeVat" BOOLEAN NOT NULL,
    "paidByStaffId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_branchId_paidAt_idx" ON "payments"("branchId", "paidAt");

-- CreateIndex
CREATE INDEX "payments_tableSessionId_idx" ON "payments"("tableSessionId");

-- CreateIndex
CREATE INDEX "orders_paymentId_idx" ON "orders"("paymentId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paidByStaffId_fkey" FOREIGN KEY ("paidByStaffId") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
