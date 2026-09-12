import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { OrderType, PaymentMethod, SalePointKind } from "@/lib/generated/prisma/enums";
import type { MessageKey } from "@/lib/i18n/vi";
import { canManageShift } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { ORDER_TYPE_FOR_SALE_POINT } from "@/lib/sale-point";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * กะการขาย (บทที่ 15)
 *
 * ── หนึ่งสาขา = หนึ่งกะที่เปิดอยู่ ──────────────────────────────────────
 * ร้านมีลิ้นชักเดียว ใครรับเงินก็เข้ากะเดียวกัน — ถ้าวันหนึ่งต้องมีหลายลิ้นชัก
 * ต้องเพิ่มคอลัมน์ `register` ที่ `Shift` **ห้ามแก้เป็น "หนึ่งคนหนึ่งกะ" เฉย ๆ**
 * เพราะเงินในลิ้นชักใบเดียวจะถูกนับซ้ำโดยสองคน
 *
 * ── ระบบกะไม่ใช่ด่านขวางการขาย ─────────────────────────────────────────
 * ไม่มีกะเปิดก็รับเงินได้ (`Payment.shiftId = null`) เงินพวกนั้นถูกนับแยกและ
 * แสดงบนหน้าเปิดกะ — ร้านที่ลืมเปิดกะต้องขายได้ต่อไป ไม่ใช่หยุดรับเงินทั้งร้าน
 *
 * ── ไฟล์นี้ไม่แปลภาษา ──────────────────────────────────────────────────
 * คืน `errorKey` ให้หน้าจอไปแปลเอง (กฎจากก้อน i18n) — smoke จึงตรวจ **คีย์**
 * ไม่ใช่ประโยค ซึ่งไม่พังเมื่อมีคนแก้ถ้อยคำในพจนานุกรม
 */

type ShiftFailure = { ok: false; errorKey: MessageKey };

/** กะที่เปิดอยู่ของสาขานี้ — null = ยังไม่ได้เปิดกะ */
export async function getOpenShift(branchId: string) {
  return prisma.shift.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
}

export async function openShift(
  staff: CurrentStaff,
  input: { openingFloat: number },
): Promise<{ ok: true; shiftId: string } | ShiftFailure> {
  // การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์ — action ถูกยิงตรงด้วย POST ได้
  if (!canManageShift(staff.role)) {
    return { ok: false, errorKey: "error.cannot_manage_shift" };
  }

  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) {
    return { ok: false, errorKey: "error.opening_float_invalid" };
  }

  try {
    const shift = await prisma.$transaction(async (tx) => {
      const created = await tx.shift.create({
        data: {
          branchId: staff.branchId,
          openedByStaffId: staff.id,
          openingFloat: input.openingFloat,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          action: "shift.open",
          entityType: "shift",
          entityId: created.id,
          metadata: { openingFloat: input.openingFloat },
        },
      });

      return created;
    });

    await publishRealtimeEvent({
      v: REALTIME_EVENT_VERSION,
      type: "shift.changed",
      branchId: staff.branchId,
      tableId: null,
      at: Date.now(),
    });

    return { ok: true, shiftId: shift.id };
  } catch (error) {
    /**
     * ชนกับ partial unique index = มีกะเปิดอยู่แล้ว
     *
     * ปล่อยให้ฐานเป็นคนตอบแทนที่จะ "อ่านก่อนแล้วค่อยสร้าง" เพราะสองคำสั่งนั้น
     * มีช่องว่างระหว่างกัน — สองเครื่องที่กดพร้อมกันจะผ่านด่านอ่านทั้งคู่
     */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, errorKey: "error.shift_already_open" };
    }

    throw error;
  }
}

/** วิธีจ่ายที่ต้องมีบรรทัดในใบสรุปเสมอ แม้ยอดเป็นศูนย์ — คนอ่านต้องเห็นว่าไม่มี ไม่ใช่หาไม่เจอ */
const REPORTED_METHODS: readonly PaymentMethod[] = ["CASH", "QR", "CARD"];
const REPORTED_SALE_POINTS: readonly OrderType[] = ["DINE_IN", "TAKEAWAY", "DELIVERY"];

function emptyBuckets<T extends string>(keys: readonly T[]) {
  return Object.fromEntries(keys.map((key) => [key, { count: 0, total: 0 }])) as Record<
    T,
    { count: number; total: number }
  >;
}

/**
 * สรุปสดของกะที่ยังเปิดอยู่ (X report) — **ไม่บันทึกอะไรเลย**
 *
 * ดูกี่ครั้งก็ได้ ไม่ทิ้งร่องรอย ต่างจากการปิดกะที่เขียน snapshot ลงแถว Shift
 *
 * **รับเฉพาะกะที่ยังเปิดอยู่** — กะที่ปิดแล้วต้องอ่านผ่าน `getShift()` เท่านั้น
 * ไม่งั้นจะมีสองทางที่ให้ตัวเลขของกะเดียวกัน แล้ววันหนึ่งสองทางนั้นจะไม่ตรงกัน
 * (คิดสดจะขยับตามอัตราภาษีที่เปลี่ยน ส่วน snapshot ไม่ขยับ)
 */
export async function getShiftReport(branchId: string, shiftId: string) {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, branchId, status: "OPEN" },
  });

  if (!shift) {
    return null;
  }

  const payments = await prisma.payment.findMany({
    where: { shiftId: shift.id, branchId },
    select: {
      method: true,
      grandTotal: true,
      discountAmount: true,
      staffCustomerId: true,
      tableSession: { select: { table: { select: { kind: true } } } },
    },
  });

  return summarizePayments(shift, payments);
}

/**
 * แกนกลางที่ทั้ง X report และการปิดกะใช้ร่วมกัน — ห้ามคิดยอดซ้ำอีกที่
 *
 * generic ที่ `shift` ไม่ใช่ของประดับ: ถ้าประกาศเป็น `{ id, openingFloat }` ตรง ๆ
 * ผลลัพธ์จะพกแค่สองฟิลด์นั้นออกไป แล้วหน้าจอที่ต้องการ `openedAt` จะพัง
 * — คืนแถวเต็มที่ผู้เรียกส่งเข้ามา ไม่ใช่ร่างที่ถูกตัดทิ้ง
 */
function summarizePayments<S extends { id: string; openingFloat: number }>(
  shift: S,
  payments: {
    method: PaymentMethod;
    grandTotal: number;
    discountAmount: number;
    staffCustomerId: string | null;
    tableSession: { table: { kind: SalePointKind } };
  }[],
) {
  const byMethod = emptyBuckets(REPORTED_METHODS);
  const bySalePoint = emptyBuckets(REPORTED_SALE_POINTS);

  let salesTotal = 0;
  let cashTotal = 0;
  let discountTotal = 0;
  let staffMealCount = 0;

  for (const payment of payments) {
    salesTotal += payment.grandTotal;
    discountTotal += payment.discountAmount;

    if (payment.staffCustomerId) {
      staffMealCount += 1;
    }

    /**
     * เงินที่ "เข้าลิ้นชัก" คือ `grandTotal` ไม่ใช่ `receivedAmount`
     * — ลูกค้ายื่นแบงก์ใหญ่จ่ายค่าอาหาร เงินที่ค้างอยู่ในลิ้นชักคือยอดบิล
     * ส่วนที่เหลือทอนออกไปแล้ว (`changeAmount`)
     */
    if (payment.method === "CASH") {
      cashTotal += payment.grandTotal;
    }

    byMethod[payment.method].count += 1;
    byMethod[payment.method].total += payment.grandTotal;

    // แปลง kind → OrderType ด้วยตารางเดียวของระบบ ห้ามเขียน kind === "DINE_IN" ที่นี่อีก
    const salePoint = ORDER_TYPE_FOR_SALE_POINT[payment.tableSession.table.kind];

    bySalePoint[salePoint].count += 1;
    bySalePoint[salePoint].total += payment.grandTotal;
  }

  return {
    shift,
    expectedCash: shift.openingFloat + cashTotal,
    cashTotal,
    salesTotal,
    billCount: payments.length,
    byMethod,
    bySalePoint,
    discountTotal,
    staffMealCount,
  };
}

export type ShiftReport = NonNullable<Awaited<ReturnType<typeof getShiftReport>>>;

/**
 * เงินสดที่รับตอนไม่มีกะเปิดอยู่ — ยอดที่ **ไม่ถูกนับเข้ากะไหนเลย**
 *
 * ต้องมองเห็นได้ ไม่ใช่หายเงียบ: คนที่เปิดกะเช้าวันถัดไปจะเจอเงินเกินในลิ้นชัก
 * แล้วไม่มีทางรู้ว่ามาจากไหน ถ้าหน้าจอไม่บอก
 *
 * นับเฉพาะที่ยังไม่ถูก "กลืน" เข้ากะไหน คือ `shiftId = null` ตรง ๆ
 */
export async function getCashOutsideShift(branchId: string) {
  const rows = await prisma.payment.aggregate({
    where: { branchId, shiftId: null, method: "CASH" },
    _sum: { grandTotal: true },
    _count: { _all: true },
    _min: { paidAt: true },
    _max: { paidAt: true },
  });

  return {
    total: rows._sum.grandTotal ?? 0,
    count: rows._count._all,
    firstAt: rows._min.paidAt,
    lastAt: rows._max.paidAt,
  };
}

/** กะใบหนึ่งพร้อม snapshot ที่บันทึกไว้ตอนปิด — ห้ามคิดยอดใหม่จากตรงนี้ */
export async function getShift(branchId: string, shiftId: string) {
  return prisma.shift.findFirst({
    where: { id: shiftId, branchId },
    include: {
      openedByStaff: { select: { name: true } },
      closedByStaff: { select: { name: true } },
      branch: { select: { name: true, currency: true, timezone: true } },
    },
  });
}

export async function closeShift(
  staff: CurrentStaff,
  input: { shiftId: string; countedCash: number; note?: string | null },
): Promise<{ ok: true; shiftId: string; alreadyClosed: boolean } | ShiftFailure> {
  if (!canManageShift(staff.role)) {
    return { ok: false, errorKey: "error.cannot_manage_shift" };
  }

  if (!Number.isInteger(input.countedCash) || input.countedCash < 0) {
    return { ok: false, errorKey: "error.counted_cash_invalid" };
  }

  const note = input.note?.trim() ?? "";

  const result = await prisma.$transaction(
    async (tx): Promise<{ ok: true; shiftId: string; alreadyClosed: boolean } | ShiftFailure> => {
      /**
       * อ่านและตรวจก่อน แต่ยังไม่เขียน — ต้องรู้ยอดก่อนถึงจะตัดสินได้ว่า
       * "ส่วนต่างไม่เป็นศูนย์แล้วไม่มีหมายเหตุ" ซึ่งเป็นเหตุผลที่ปฏิเสธได้
       */
      const shift = await tx.shift.findFirst({
        where: { id: input.shiftId, branchId: staff.branchId },
      });

      if (!shift) {
        return { ok: false, errorKey: "error.shift_not_found" };
      }

      if (shift.status === "CLOSED") {
        // กดซ้ำ = คืนใบเดิม ไม่ใช่ error (ท่าเดียวกับกันจ่ายซ้ำของบทที่ 11)
        return { ok: true, shiftId: shift.id, alreadyClosed: true };
      }

      const payments = await tx.payment.findMany({
        where: { shiftId: shift.id, branchId: staff.branchId },
        select: {
          method: true,
          grandTotal: true,
          discountAmount: true,
          staffCustomerId: true,
          tableSession: { select: { table: { select: { kind: true } } } },
        },
      });

      const summary = summarizePayments(shift, payments);
      const difference = input.countedCash - summary.expectedCash;

      /**
       * ส่วนต่างที่ไม่มีคำอธิบายคือสิ่งที่ตรวจสอบย้อนหลังไม่ได้เลย
       *
       * บังคับกรอกตรงนี้ ไม่ใช่แค่ที่หน้าจอ เพราะ action ถูกยิงตรงด้วย POST ได้
       */
      if (difference !== 0 && note.length < 3) {
        return { ok: false, errorKey: "error.cash_difference_needs_note" };
      }

      /**
       * ปิดแบบมีเงื่อนไข = คำสั่งที่ทั้งตรวจและเขียนในครั้งเดียว
       *
       * สองเครื่องที่กดปิดพร้อมกัน เครื่องที่สองรอ row lock แล้วอ่าน WHERE ใหม่
       * (Postgres READ COMMITTED) ได้ count = 0 → คืนใบเดิม ไม่ใช่เขียนทับตัวเลข
       * ของเครื่องแรกด้วยยอดที่นับคนละครั้ง
       *
       * การรวมยอดอยู่ในทรานแซกชันเดียวกับการปิด — ถ้าแยกออกไป บิลที่จ่าย
       * ระหว่างนั้นจะหายจากทั้งสองกะ (ไม่อยู่ในใบที่ปิด เพราะรวมยอดไปก่อนแล้ว ·
       * ไม่อยู่ในกะถัดไป เพราะ shiftId ชี้กะที่ปิดไปแล้ว)
       */
      const claimed = await tx.shift.updateMany({
        where: { id: shift.id, branchId: staff.branchId, status: "OPEN" },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedByStaffId: staff.id,
          countedCash: input.countedCash,
          expectedCash: summary.expectedCash,
          cashDifference: difference,
          salesTotal: summary.salesTotal,
          billCount: summary.billCount,
          breakdown: {
            byMethod: summary.byMethod,
            bySalePoint: summary.bySalePoint,
            discountTotal: summary.discountTotal,
            staffMealCount: summary.staffMealCount,
          },
          note: note.length > 0 ? note : null,
        },
      });

      if (claimed.count === 0) {
        return { ok: true, shiftId: shift.id, alreadyClosed: true };
      }

      await tx.auditLog.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          action: "shift.close",
          entityType: "shift",
          entityId: shift.id,
          metadata: {
            expectedCash: summary.expectedCash,
            countedCash: input.countedCash,
            cashDifference: difference,
            salesTotal: summary.salesTotal,
            billCount: summary.billCount,
            note: note.length > 0 ? note : null,
          },
        },
      });

      return { ok: true, shiftId: shift.id, alreadyClosed: false };
    },
  );

  // ยิงหลัง commit เสมอ — ห้าม publish ข้างใน $transaction (กฎ CLAUDE.md บทที่ 8)
  if (result.ok && !result.alreadyClosed) {
    await publishRealtimeEvent({
      v: REALTIME_EVENT_VERSION,
      type: "shift.changed",
      branchId: staff.branchId,
      tableId: null,
      at: Date.now(),
    });
  }

  return result;
}

/**
 * ประวัติกะย้อนหลังของสาขา — ใหม่สุดอยู่บนสุด
 *
 * ไม่แบ่งหน้าเหมือน `/admin/receipts` เพราะกะเกิดวันละหนึ่งถึงสามใบ
 * (60 ใบ ≈ สองเดือน) — ถ้าวันหนึ่งร้านมีหลายสาขาในหน้าเดียวค่อยเพิ่ม
 */
export async function listShifts(branchId: string, options: { limit?: number } = {}) {
  return prisma.shift.findMany({
    where: { branchId },
    orderBy: { openedAt: "desc" },
    take: options.limit ?? 60,
    include: {
      openedByStaff: { select: { name: true } },
      closedByStaff: { select: { name: true } },
    },
  });
}

export type ShiftListRow = Awaited<ReturnType<typeof listShifts>>[number];
