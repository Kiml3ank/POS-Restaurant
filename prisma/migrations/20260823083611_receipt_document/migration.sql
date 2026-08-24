-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('TAX_ABB', 'RECEIPT');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "document_counters" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "ReceiptKind" NOT NULL,
    "sellerName" TEXT NOT NULL,
    "sellerTaxId" TEXT,
    "sellerBranchName" TEXT NOT NULL,
    "sellerAddress" TEXT,
    "sellerPhone" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "firstPrintedAt" TIMESTAMP(3),
    "lastPrintedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_counters_branchId_series_key" ON "document_counters"("branchId", "series");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_paymentId_key" ON "receipts"("paymentId");

-- CreateIndex
CREATE INDEX "receipts_branchId_issuedAt_idx" ON "receipts"("branchId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_branchId_series_seq_key" ON "receipts"("branchId", "series", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_branchId_number_key" ON "receipts"("branchId", "number");

-- AddForeignKey
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill (เขียนเอง ไม่ใช่ของที่ generator สร้าง)
--
-- เหตุผลที่ต้อง backfill ไม่ใช่ปล่อยว่าง: ถ้าปล่อยให้มี Payment ที่ไม่มี Receipt
-- หน้า /admin/receipts จะแสดงน้อยกว่าจำนวนการรับเงินจริงตั้งแต่วันแรก แล้วคนที่มา
-- กระทบยอดจะสรุปว่าระบบทำเอกสารหาย — เลขที่ต่อเนื่องต้องเริ่มต่อเนื่องตั้งแต่แถวแรก
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) ทุกสาขาต้องมีตัวเดินเลขของชุด ABB ตั้งแต่วินาทีแรก
--    (ไม่ใช่สร้างเอาตอน upsert ครั้งแรก ซึ่งจะมีเคส race ตอนสองเครื่องรับเงินพร้อมกัน
--     ในนาทีแรกของสาขาใหม่ แล้วเครื่องหนึ่งชน unique violation ทั้งที่ลูกค้าจ่ายแล้ว)
INSERT INTO "document_counters" ("id", "branchId", "series", "lastSeq", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, b."id", 'ABB', 0, NOW(), NOW()
FROM "branches" b;

-- 2) ออกใบย้อนหลังให้การรับเงินที่มีอยู่ เรียงตามเวลาที่รับเงินจริงต่อสาขา
--    snapshot ตัวตนผู้ขายจากค่าปัจจุบัน ซึ่งเป็นค่าที่ดีที่สุดที่เรารู้สำหรับใบเก่า
INSERT INTO "receipts" (
  "id", "branchId", "paymentId", "series", "seq", "number", "kind",
  "sellerName", "sellerTaxId", "sellerBranchName", "sellerAddress", "sellerPhone",
  "issuedAt", "printCount", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."branchId",
  p."id",
  'ABB',
  numbered."seq",
  b."code" || '-' || lpad(numbered."seq"::text, 8, '0'),
  CASE WHEN p."currency" = 'THB' THEN 'TAX_ABB'::"ReceiptKind" ELSE 'RECEIPT'::"ReceiptKind" END,
  t."name",
  -- เลขผู้เสียภาษีขึ้นเฉพาะเอกสารไทย สาขา LAK/VND ห้ามมีเลขนี้บนใบ
  CASE WHEN p."currency" = 'THB' THEN t."taxId" ELSE NULL END,
  b."name",
  b."addressLine",
  b."phone",
  p."paidAt",
  0,
  NOW(),
  NOW()
FROM (
  SELECT
    p2."id",
    row_number() OVER (PARTITION BY p2."branchId" ORDER BY p2."paidAt", p2."id") AS "seq"
  FROM "payments" p2
) AS numbered
JOIN "payments" p ON p."id" = numbered."id"
JOIN "branches" b ON b."id" = p."branchId"
JOIN "tenants"  t ON t."id" = b."tenantId";

-- 3) ดันตัวเดินเลขให้ตรงกับใบที่เพิ่งออกย้อนหลัง ไม่งั้นใบถัดไปจะชน unique
UPDATE "document_counters" dc
SET
  "lastSeq" = COALESCE(
    (SELECT MAX(r."seq") FROM "receipts" r
      WHERE r."branchId" = dc."branchId" AND r."series" = dc."series"),
    0
  ),
  "updatedAt" = NOW()
WHERE dc."series" = 'ABB';
