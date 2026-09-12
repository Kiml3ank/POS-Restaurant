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

/** แกนกลางที่ทั้ง X report และการปิดกะใช้ร่วมกัน — ห้ามคิดยอดซ้ำอีกที่ */
function summarizePayments(
  shift: { id: string; openingFloat: number },
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
