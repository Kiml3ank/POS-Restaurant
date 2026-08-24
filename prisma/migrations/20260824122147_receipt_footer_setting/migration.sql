-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "receiptFooter" TEXT;

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "sellerFooter" TEXT;
