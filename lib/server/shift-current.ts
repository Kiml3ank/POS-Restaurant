import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * id ของกะที่เปิดอยู่ของสาขานี้ — คืน null เมื่อไม่มีกะเปิด
 *
 * ── ทำไมเป็นไฟล์แยกที่มีฟังก์ชันเดียว ───────────────────────────────────
 * `payment.ts` ต้องเรียกตัวนี้ **ข้างใน `$transaction`** ของการรับเงิน ถ้าให้ไป
 * import `shift.ts` (ซึ่งวันหนึ่งจะ import `billing.ts` เพื่อทำรายงาน) จะเกิด
 * import cycle — ท่าเดียวกับที่บทที่ 12 แยก `receipt-issue.ts` ออกจาก `receipt.ts`
 * **ห้ามเพิ่ม import ที่ชี้กลับไปหา `payment.ts` / `shift.ts` ในไฟล์นี้**
 *
 * ── ทำไมต้องรับ `tx` ไม่ใช่ใช้ prisma ตรง ๆ ─────────────────────────────
 * เพราะคำถาม "ตอนนี้กะไหนเปิดอยู่" ต้องถูกถามในทรานแซกชันเดียวกับที่เขียนแถว
 * Payment ไม่งั้นจะมีช่องที่ปิดกะแทรกกลาง แล้วเงินก้อนนั้นถูกผูกกับกะที่ปิดไปแล้ว
 * — ใบสรุปที่พิมพ์ออกไปจะไม่มีเงินก้อนนั้น ทั้งที่แถวในฐานบอกว่าอยู่ในกะนั้น
 */
export async function resolveOpenShiftId(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<string | null> {
  const shift = await tx.shift.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });

  return shift?.id ?? null;
}
