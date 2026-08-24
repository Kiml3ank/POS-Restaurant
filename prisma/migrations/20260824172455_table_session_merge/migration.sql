-- AlterEnum
ALTER TYPE "TableSessionStatus" ADD VALUE 'MERGED';

-- AlterTable
ALTER TABLE "table_sessions" ADD COLUMN     "mergedIntoSessionId" TEXT;

-- CreateIndex
CREATE INDEX "table_sessions_mergedIntoSessionId_idx" ON "table_sessions"("mergedIntoSessionId");

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_mergedIntoSessionId_fkey" FOREIGN KEY ("mergedIntoSessionId") REFERENCES "table_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
