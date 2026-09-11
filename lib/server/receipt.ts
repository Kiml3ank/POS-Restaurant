import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { Currency, PaymentMethod, SalePointKind } from "@/lib/generated/prisma/enums";
import { canBrowseReceipts, canReprintReceipt } from "@/lib/rbac";
import { branchDayRangeUtc } from "@/lib/server/branch-time";
import { prisma } from "@/lib/server/db";
import { getPayment } from "@/lib/server/payment";
import type { CurrentStaff } from "@/lib/server/staff-session";
import type { MessageParams } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/vi";

/**
 * ใบเสร็จ / ใบกำกับภาษีอย่างย่อ — ฝั่งฐานข้อมูล (บทที่ 12)
 *
 * ── กฎประจำไฟล์นี้ ────────────────────────────────────────────────────────
 * 1. **ทุกตัวเลขเงินบนใบมาจาก `Payment` เท่านั้น** ห้ามบวกจาก `Order` เอง
 *    และห้ามกลับไปอ่านอัตรา VAT/เซอร์วิสชาร์จจาก `Branch` (ดู CLAUDE.md บทที่ 10-11)
 * 2. **ตัวตนผู้ขายมาจาก snapshot ในแถว `Receipt`** ห้าม join `Tenant`/`Branch`
 *    สดตอนพิมพ์ซ้ำ — ร้านเปลี่ยนชื่อ/ย้ายที่อยู่ได้ แต่ใบเดิมต้องไม่เปลี่ยนตาม
 * 3. การ **ออกใบ** ไม่ได้อยู่ที่นี่ — อยู่ที่ lib/server/receipt-issue.ts ซึ่งแยกเป็น
 *    leaf module เพื่อกัน import cycle กับ lib/server/payment.ts (ดูเหตุผลในไฟล์นั้น)
 *
 * ⚠ เนื้อหาภาษีในบทนี้ไม่ใช่คำแนะนำทางกฎหมาย ต้องให้ผู้สอบบัญชี/สรรพากรตรวจก่อนใช้จริง
 */

export type ReceiptDetail = NonNullable<Awaited<ReturnType<typeof getReceipt>>>;

/**
 * อ่านเอกสารหนึ่งใบพร้อมทุกอย่างที่ต้องพิมพ์
 *
 * ใช้ `getPayment()` ซ้ำสำหรับยอดและบรรทัดสินค้า **โดยตั้งใจ** — ฟังก์ชันนั้น
 * อ่านจาก snapshot ล้วนอยู่แล้ว การเขียน query ชุดที่สองขึ้นมาแปลว่าวันหนึ่ง
 * หน้าสรุปการรับเงินกับใบเสร็จจะแสดงตัวเลขไม่ตรงกันโดยไม่มีใครรู้ว่าอันไหนถูก
 */
export async function getReceipt(branchId: string, receiptId: string) {
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, branchId } });

  if (!receipt) {
    return null;
  }

  const payment = await getPayment(branchId, receipt.paymentId);

  /**
   * `Payment -> Receipt` เป็น Restrict กรณีนี้จึงเกิดไม่ได้ในทางปฏิบัติ แต่ต้องเช็ค
   * เพราะ TypeScript ไม่รู้เรื่อง foreign key และถ้าวันหนึ่งมันเกิดขึ้นจริง
   * เราอยากได้ "ไม่พบใบเสร็จ" ไม่ใช่หน้าพังกลางคัน
   */
  if (!payment) {
    return null;
  }

  return { receipt, ...payment };
}

export type ListReceiptsFilters = {
  /** ช่วงวันที่ตามเวลาของสาขา รูปแบบ YYYY-MM-DD (จากช่อง input type=date) */
  from?: string | null;
  to?: string | null;
  method?: PaymentMethod | null;
  /** ค้นด้วยเลขที่บนใบ หรือชื่อโต๊ะ */
  q?: string | null;
  page?: number;
};

/** จำนวนแถวต่อหน้า — เล็กพอให้จอแท็บเล็ตแสดงได้หมดโดยไม่ต้องเลื่อนหลายจอ */
export const RECEIPTS_PAGE_SIZE = 25;

export type ReceiptListRow = {
  id: string;
  number: string;
  issuedAt: Date;
  method: PaymentMethod;
  currency: Currency;
  grandTotal: number;
  printCount: number;
  /**
   * **ชิ้นส่วน** ของชื่อบิล ไม่ใช่ชื่อสำเร็จรูป — "Bàn A1" / "Takeaway #12"
   * ขึ้นกับภาษาของจอ และไฟล์นี้อยู่ใน lib/server ซึ่งห้ามแปลภาษา
   * หน้าจอประกอบเองด้วย `salePointDisplayName(row.salePoint, row.salePoint, t)`
   * (object เดียวใส่ได้ทั้งสองช่องเพราะมีครบทั้ง name/kind และ queueNumber)
   */
  salePoint: { name: string; kind: SalePointKind; queueNumber: number | null };
  staffName: string | null;
};

export type ListReceiptsResult =
  | { ok: false; errorKey: MessageKey; params?: MessageParams }
  | { ok: true; rows: ReceiptListRow[]; page: number; pageCount: number; total: number };

/**
 * ลิสต์ใบเสร็จย้อนหลังของสาขาตัวเอง
 *
 * **`canBrowseReceipts` ไม่ใช่ `canReprintReceipt`** — ลิสต์นี้เผยยอดขายทั้งสาขา
 * (จำนวนบิลต่อวัน ยอดเฉลี่ย ช่วงเวลาที่ขายดี) ซึ่งเป็นข้อมูลคนละระดับกับ
 * การพิมพ์ใบซ้ำให้ลูกค้าที่ยืนอยู่ตรงหน้า ดูเหตุผลเต็มใน lib/rbac.ts
 */
export async function listReceipts(
  staff: CurrentStaff,
  filters: ListReceiptsFilters = {},
): Promise<ListReceiptsResult> {
  if (!canBrowseReceipts(staff.role)) {
    return { ok: false, errorKey: "error.cannot_browse_receipts" as const };
  }

  const where: Prisma.ReceiptWhereInput = { branchId: staff.branchId };

  const range = branchDayRangeUtc(filters.from, filters.to, staff.branch.timezone);
  if (range) {
    where.issuedAt = range;
  }

  if (filters.method) {
    where.payment = { method: filters.method };
  }

  const q = filters.q?.trim();
  if (q) {
    /**
     * ค้นได้สามอย่างที่คนถืออยู่ในมือจริง ๆ: เลขบนใบ · ชื่อโต๊ะ · **เลขคิว**
     *
     * เลขคิวต้องมี เพราะบิลซื้อกลับไม่มีชื่อโต๊ะให้ค้น (ทุกใบอยู่บนจุดขายชื่อเดียวกัน)
     * ลูกค้าที่เดินกลับมาถามถึงใบเสร็จของตัวเองพูดว่า "คิว 12" ไม่ใช่เลขที่ใบ
     *
     * ดึงเฉพาะตัวเลขออกมาจากคำค้น จึงพิมพ์ได้ทั้ง "12" และ "คิว 12" — และเลข
     * ที่ยาวเกินช่วง Int ต้องตัดทิ้ง ไม่ใช่ส่งให้ Prisma ไปพังที่ชั้นฐานข้อมูล
     * (คนพิมพ์เลขที่ใบแบบไม่มีขีดจะได้เลขยาว ๆ แบบนั้นพอดี)
     */
    const digits = q.match(/\d+/)?.[0];
    const queueNumber = digits && digits.length <= 9 ? Number(digits) : null;

    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { payment: { tableSession: { table: { name: { contains: q, mode: "insensitive" } } } } },
      ...(queueNumber === null ? [] : [{ payment: { tableSession: { queueNumber } } }]),
    ];
  }

  const page = Math.max(1, Math.trunc(filters.page ?? 1));

  const [total, receipts] = await Promise.all([
    prisma.receipt.count({ where }),
    prisma.receipt.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * RECEIPTS_PAGE_SIZE,
      take: RECEIPTS_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        issuedAt: true,
        printCount: true,
        payment: {
          select: {
            method: true,
            currency: true,
            grandTotal: true,
            paidByStaff: { select: { name: true } },
            tableSession: {
              select: {
                queueNumber: true,
                table: { select: { name: true, kind: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    ok: true,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / RECEIPTS_PAGE_SIZE)),
    rows: receipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      issuedAt: receipt.issuedAt,
      printCount: receipt.printCount,
      method: receipt.payment.method,
      currency: receipt.payment.currency,
      grandTotal: receipt.payment.grandTotal,
      // ห้ามให้หน้าจอใช้ `name` ดิบ ๆ เป็นชื่อบิล — เคาน์เตอร์มีชื่อเดียวแต่มีลูกค้า
      // หลายคน ต้องผ่าน salePointDisplayName() ที่ดูเลขคิวด้วยเสมอ
      salePoint: {
        name: receipt.payment.tableSession.table.name,
        kind: receipt.payment.tableSession.table.kind,
        queueNumber: receipt.payment.tableSession.queueNumber,
      },
      staffName: receipt.payment.paidByStaff?.name ?? null,
    })),
  };
}

export type RecordPrintResult = { ok: true; printCount: number } | { ok: false; errorKey: MessageKey; params?: MessageParams };

/**
 * บันทึกว่ามีการพิมพ์ใบนี้ออกไปหนึ่งครั้ง
 *
 * ── ทำไมนับจากปุ่ม ไม่ใช่ `onafterprint` ของเบราว์เซอร์ ─────────────────────
 * event นั้นยิงตอนผู้ใช้กด Ctrl+P เองด้วย ยิงตอนกดยกเลิกในกล่องพิมพ์ด้วย และ
 * แต่ละเบราว์เซอร์ยิงไม่เหมือนกัน — "เปิดหน้าดูเฉย ๆ" ไม่ควรถูกนับว่าออกสำเนา
 * ให้ลูกค้า เพราะตัวเลขนี้คือสิ่งที่ตอบคำถาม "ใบนี้ถูกออกไปกี่ใบ" ตอนตรวจสอบ
 *
 * AuditLog เขียนทุกครั้ง **รวมครั้งแรกด้วย** เพราะสิ่งที่ต้องตอบให้ได้ย้อนหลังคือ
 * "ใครถือใบนี้ไปบ้าง" ไม่ใช่แค่ "มีการพิมพ์ซ้ำผิดปกติหรือเปล่า"
 */
export async function recordReceiptPrint(
  staff: CurrentStaff,
  receiptId: string,
): Promise<RecordPrintResult> {
  if (!canReprintReceipt(staff.role)) {
    return {
      ok: false,
      errorKey: "error.cannot_print_receipt" as const,
    };
  }

  const printedAt = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.receipt.findFirst({
      where: { id: receiptId, branchId: staff.branchId },
      select: { id: true, number: true, printCount: true },
    });

    if (!existing) {
      return null;
    }

    const receipt = await tx.receipt.update({
      where: { id: existing.id },
      data: {
        printCount: { increment: 1 },
        lastPrintedAt: printedAt,
        // ครั้งแรกเท่านั้นที่ตั้งค่านี้ — ครั้งต่อ ๆ ไปต้องไม่ทับ
        ...(existing.printCount === 0 ? { firstPrintedAt: printedAt } : {}),
      },
      select: { printCount: true },
    });

    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "receipt.print",
        entityType: "receipt",
        entityId: existing.id,
        metadata: {
          number: existing.number,
          printCount: receipt.printCount,
          /** true = สำเนา ไม่ใช่ต้นฉบับ — สิ่งที่ผู้ตรวจสอบมองหาเป็นอันดับแรก */
          isCopy: receipt.printCount > 1,
        },
      },
    });

    return receipt;
  });

  if (!outcome) {
    return { ok: false, errorKey: "error.receipt_not_found" as const };
  }

  return { ok: true, printCount: outcome.printCount };
}
