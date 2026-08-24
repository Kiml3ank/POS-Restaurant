import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { Currency, PaymentMethod } from "@/lib/generated/prisma/enums";
import { canBrowseReceipts, canReprintReceipt } from "@/lib/rbac";
import { salePointDisplayName } from "@/lib/sale-point";
import { prisma } from "@/lib/server/db";
import { getPayment } from "@/lib/server/payment";
import type { CurrentStaff } from "@/lib/server/staff-session";

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
  tableName: string | null;
  staffName: string | null;
};

export type ListReceiptsResult =
  | { ok: false; error: string }
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
    return { ok: false, error: "ตำแหน่งของคุณไม่มีสิทธิ์ดูใบเสร็จย้อนหลังทั้งสาขา" };
  }

  const where: Prisma.ReceiptWhereInput = { branchId: staff.branchId };

  const range = dayRangeToUtc(filters.from, filters.to, staff.branch.timezone);
  if (range) {
    where.issuedAt = range;
  }

  if (filters.method) {
    where.payment = { method: filters.method };
  }

  const q = filters.q?.trim();
  if (q) {
    // ค้นได้สองอย่างที่คนถืออยู่ในมือจริง ๆ: เลขบนใบ กับชื่อโต๊ะ
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { payment: { tableSession: { table: { name: { contains: q, mode: "insensitive" } } } } },
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
      // ชื่อที่คนอ่านออกว่าเป็นบิลของใคร — "โต๊ะ A1" หรือ "ซื้อกลับ คิว 12"
      // ห้ามใช้ `table.name` ดิบ ๆ เพราะเคาน์เตอร์มีชื่อเดียวแต่มีลูกค้าหลายคน
      tableName: salePointDisplayName(receipt.payment.tableSession.table, receipt.payment.tableSession),
      staffName: receipt.payment.paidByStaff?.name ?? null,
    })),
  };
}

export type RecordPrintResult = { ok: true; printCount: number } | { ok: false; error: string };

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
      error: "ตำแหน่งของคุณไม่มีสิทธิ์พิมพ์ใบเสร็จ กรุณาเรียกแคชเชียร์หรือผู้จัดการ",
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
    return { ok: false, error: "ไม่พบใบเสร็จนี้ในสาขาของคุณ" };
  }

  return { ok: true, printCount: outcome.printCount };
}

/**
 * แปลงช่วงวันแบบ YYYY-MM-DD ตาม **เวลาของสาขา** ให้เป็นช่วง UTC ที่ Prisma ใช้ได้
 *
 * ทำเองแทนที่จะพึ่ง `new Date("2026-08-23")` เพราะอันนั้นตีความเป็น UTC เที่ยงคืน
 * ซึ่งสำหรับสาขาที่กรุงเทพ (+07:00) แปลว่า **07:00 ของวันนั้น** — บิลตั้งแต่เที่ยงคืน
 * ถึงเจ็ดโมงเช้าจะหายไปจากผลค้นโดยไม่มีอะไรฟ้อง และร้านอาหารที่ปิดตีสองมีบิล
 * ในช่วงนั้นจริง ๆ ทุกวัน
 */
function dayRangeToUtc(
  from: string | null | undefined,
  to: string | null | undefined,
  timezone: string,
): { gte?: Date; lt?: Date } | null {
  const gte = from ? startOfDayUtc(from, timezone) : undefined;
  // ปลายช่วงเป็น "เที่ยงคืนของวันถัดไป" + lt เพื่อให้ทั้งวันที่เลือกถูกนับครบ
  const lt = to ? startOfDayUtc(to, timezone, 1) : undefined;

  if (!gte && !lt) {
    return null;
  }

  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}

/** เที่ยงคืนของวัน ymd ตามโซนเวลา timezone แปลงเป็น Date (UTC) — บวก addDays วันได้ */
function startOfDayUtc(ymd: string, timezone: string, addDays = 0): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) {
    return undefined;
  }

  const [, y, m, d] = match;
  const base = Date.UTC(Number(y), Number(m) - 1, Number(d) + addDays);

  /**
   * หา offset ของโซนนั้น ณ เวลานั้นด้วย Intl แทนที่จะ hardcode +07:00
   * เพราะโปรเจกต์นี้รองรับสาขาที่ลาว/เวียดนามด้วย และ offset เปลี่ยนตามวันได้
   * ในบางโซน (DST) — ถึงจะไม่ใช่สามโซนที่ใช้อยู่ตอนนี้ แต่เขียนให้ถูกไว้ก่อน
   * ถูกกว่าการมาไล่หาทีหลังว่าทำไมรายงานเดือนนั้นเพี้ยนไปหนึ่งชั่วโมง
   */
  return new Date(base - timezoneOffsetMs(new Date(base), timezone));
}

function timezoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );

  return asUtc - at.getTime();
}
