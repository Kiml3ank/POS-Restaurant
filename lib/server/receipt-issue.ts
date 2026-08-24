import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { Currency } from "@/lib/generated/prisma/enums";
import { RECEIPT_SERIES, formatReceiptNumber, receiptKindForCurrency } from "@/lib/receipt";

/**
 * ออกเลขที่เอกสารและสร้างแถว Receipt (บทที่ 12) — **ที่เดียวในระบบที่กินเลขที่**
 *
 * ── ทำไมแยกไฟล์จาก lib/server/receipt.ts ──────────────────────────────────
 * ไฟล์นั้นอ่านใบเสร็จ ซึ่งต้องใช้ getPayment() จาก lib/server/payment.ts
 * ส่วน lib/server/payment.ts ต้องเรียก issueReceipt() ตอนรับเงิน — รวมไว้ไฟล์เดียว
 * จะได้ import cycle ระหว่างสองไฟล์ทันที ESM รันผ่านก็จริงเพราะทุกการเรียกอยู่ใน
 * ฟังก์ชัน แต่มันคือกับดักที่รอวันมีคนเพิ่ม const ระดับบนสุดแล้วพังตอน runtime
 * โดยที่ tsc ไม่ฟ้อง
 *
 * ไฟล์นี้จึงเป็น **leaf** โดยตั้งใจ: import แค่ type ของ Prisma กับ lib/receipt.ts
 * ห้ามเพิ่ม import ที่ชี้กลับไปหา payment.ts หรือ receipt.ts เด็ดขาด
 */

export type IssueReceiptInput = {
  branchId: string;
  paymentId: string;
  /** สกุลเงินที่ snapshot ไว้ใน Payment — ตัวตัดสินว่าออกเอกสารชนิดไหน */
  currency: Currency;
  /** ค่าที่จะ snapshot ลงใบ อ่านจาก Tenant/Branch **ณ วินาทีนี้** ครั้งเดียวตลอดกาล */
  seller: {
    branchCode: string;
    branchName: string;
    tenantName: string;
    taxId: string | null;
    addressLine: string | null;
    phone: string | null;
    /** ข้อความท้ายใบที่ร้านตั้งไว้ ณ วินาทีที่ออกใบ — null = ใช้ข้อความเริ่มต้นของระบบ */
    receiptFooter: string | null;
  };
  issuedAt: Date;
};

/**
 * ออกเอกสารหนึ่งใบให้การรับเงินหนึ่งครั้ง — **ต้องอยู่ใน transaction เดียวกับ takePayment()**
 *
 * ── ทำไม increment ต้องอยู่ตรงนี้ ไม่ใช่ก่อนหรือหลัง transaction ────────────
 * `update ... { increment: 1 }` บนแถวเดียวทำให้ Postgres ล็อกแถวนั้น สองเครื่อง
 * ที่รับเงินพร้อมกันจึงเข้าคิวกันเอง ไม่มีทางได้เลขซ้ำ (ต่างจาก `max(seq)+1`
 * ที่มีช่องว่างระหว่างอ่านกับเขียน) — และเพราะอยู่ใน transaction เดียวกัน
 * การรับเงินที่ถูก rollback จะคืนเลขกลับไปด้วย **เลขจึงไม่ขาดเป็นรู**
 * ซึ่งเป็นสิ่งเดียวที่ตรวจสอบย้อนหลังไม่ผ่านแน่ ๆ
 *
 * แถว `DocumentCounter` ต้องมีอยู่ก่อนแล้วเสมอ (migration สร้างให้สาขาเดิม ·
 * seed สร้างให้สาขาใหม่) — ที่นี่จึงใช้ `update` ไม่ใช่ `upsert` โดยตั้งใจ:
 * ถ้าแถวหาย เราต้องการให้การรับเงินล้มเหลวเสียงดังตรงนี้ ดีกว่าเงียบ ๆ สร้างสาย
 * เลขใหม่ที่เริ่มจาก 1 ทับของเดิมแล้วเลขซ้ำกันทั้งสาขา
 */
export async function issueReceipt(
  tx: Prisma.TransactionClient,
  input: IssueReceiptInput,
): Promise<{ id: string; number: string }> {
  const counter = await tx.documentCounter.update({
    where: { branchId_series: { branchId: input.branchId, series: RECEIPT_SERIES } },
    data: { lastSeq: { increment: 1 } },
    select: { lastSeq: true },
  });

  const seq = counter.lastSeq;
  const kind = receiptKindForCurrency(input.currency);

  return tx.receipt.create({
    data: {
      branchId: input.branchId,
      paymentId: input.paymentId,
      series: RECEIPT_SERIES,
      seq,
      number: formatReceiptNumber(input.seller.branchCode, seq),
      kind,
      sellerName: input.seller.tenantName,
      /**
       * เลขผู้เสียภาษีขึ้นเฉพาะเอกสารไทย — สาขา LAK/VND ต้องไม่มีเลขนี้บนใบ
       * ตัดตั้งแต่ตอนเขียนลงฐาน ไม่ใช่ตอน render เพื่อให้ไม่มีทางหลุดออกไป
       * แม้จะมีใครเขียนหน้าจอใหม่ในอนาคตแล้วลืมเงื่อนไข
       */
      sellerTaxId: kind === "TAX_ABB" ? input.seller.taxId : null,
      sellerBranchName: input.seller.branchName,
      sellerAddress: input.seller.addressLine,
      sellerPhone: input.seller.phone,
      sellerFooter: input.seller.receiptFooter,
      issuedAt: input.issuedAt,
    },
    select: { id: true, number: true },
  });
}
