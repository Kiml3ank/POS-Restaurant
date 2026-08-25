import "server-only";

import type { PaymentMethod, SalePointKind } from "@/lib/generated/prisma/enums";
import { AUDIT_SENSITIVE_ACTIONS } from "@/lib/audit-log";
import { canViewDashboard } from "@/lib/rbac";
import { branchTodayRangeUtc } from "@/lib/server/branch-time";
import { prisma } from "@/lib/server/db";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * หน้าแรกของหลังร้าน — ตัวเลขของ "วันนี้" + สถานะหน้าร้านตอนนี้ (spec §1)
 *
 * ── ขอบเขตที่ตั้งใจ ──────────────────────────────────────────────────────
 * ตอบสองคำถามที่เจ้าของร้านถามทุกวัน: **"วันนี้ขายได้เท่าไหร่"** และ
 * **"ตอนนี้หน้าร้านค้างอะไรอยู่"** — ไม่ใช่หน้ารายงานย้อนหลัง (บทที่ 15)
 * และไม่ใช่หน้ารวมลิงก์ เพราะแถบเมนูด้านซ้ายทำหน้าที่นั้นอยู่แล้ว
 *
 * ── สิ่งที่ยังทำไม่ได้ และเหตุผล ─────────────────────────────────────────
 *   - **กำไรขั้นต้น** — ต้องมีต้นทุนต่อเมนู (`MenuItem.costPrice`) ซึ่งยังไม่มี (spec §4)
 *   - **ของใกล้หมด** — ต้องมีสต็อก (บทที่ 14)
 *   - **กราฟย้อนหลังหลายวัน** — เป็นงานของบทที่ 15 ที่ต้องคิดเรื่องช่วงกะด้วย
 * ทั้งสามอย่างจงใจไม่ใส่ตัวเลขปลอมหรือช่องว่างไว้บนจอ — ช่องที่ขึ้นว่า "—"
 * ตลอดกาลทำให้คนเลิกดูทั้งหน้า
 *
 * ── ทำไมยอดขายมาจาก `Payment` ไม่ใช่ผลรวมของ `Order` ────────────────────
 * `Payment` คือเงินที่ได้รับจริง ส่วนยอดใน `Order` เป็น **ส่วนแบ่ง** ที่กระจาย
 * ลงไปเพื่อทำรายงานแยกช่องทาง (กฎตั้งแต่บทที่ 11) — บวก Order จะได้เลขที่ใกล้เคียง
 * แต่ไม่ใช่เงินที่อยู่ในลิ้นชักจริง
 */

export type DashboardResult =
  | { ok: false; error: string }
  | { ok: true; data: Awaited<ReturnType<typeof buildDashboard>> };

export async function getDashboard(staff: CurrentStaff): Promise<DashboardResult> {
  if (!canViewDashboard(staff.role)) {
    return { ok: false, error: "Your role can't view the branch sales summary" };
  }

  return { ok: true, data: await buildDashboard(staff) };
}

async function buildDashboard(staff: CurrentStaff) {
  const branchId = staff.branchId;
  const today = branchTodayRangeUtc(staff.branch.timezone);
  const paidToday = { branchId, paidAt: { gte: today.gte, lt: today.lt } };

  const [payments, openSessions, kitchenItems, sensitiveEvents, activeSessions] = await Promise.all([
    prisma.payment.findMany({
      where: paidToday,
      select: {
        id: true,
        method: true,
        grandTotal: true,
        discountAmount: true,
        staffCustomerId: true,
        tableSession: { select: { table: { select: { kind: true } } } },
      },
    }),

    // รอบขายที่ยังเปิดอยู่ = ของที่ค้างอยู่หน้าร้าน "ตอนนี้" ไม่เกี่ยวกับวันนี้
    prisma.tableSession.findMany({
      where: { branchId, status: "OPEN" },
      select: {
        id: true,
        table: { select: { kind: true } },
        orders: { select: { status: true, grandTotal: true, subtotal: true } },
      },
    }),

    /**
     * ของที่ครัวยังทำไม่เสร็จ + ของที่เสร็จแล้วรอยก — นับที่ระดับ **รายการ**
     * ไม่ใช่ระดับบิล ด้วยเหตุผลเดียวกับที่จอครัวกรองด้วยสถานะรายการ (บทที่ 8)
     */
    prisma.orderItem.groupBy({
      by: ["status"],
      where: {
        branchId,
        status: { in: ["PLACED", "IN_PROGRESS", "READY"] },
        order: { status: { notIn: ["DRAFT", "CANCELLED"] } },
      },
      _sum: { quantity: true },
    }),

    prisma.auditLog.count({
      where: {
        branchId,
        action: { in: [...AUDIT_SENSITIVE_ACTIONS] },
        createdAt: { gte: today.gte, lt: today.lt },
      },
    }),

    prisma.staffSession.count({
      where: { branchId, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);

  const salesTotal = payments.reduce((sum, payment) => sum + payment.grandTotal, 0);

  const byMethod = new Map<PaymentMethod, { count: number; amount: number }>();
  const byChannel = new Map<SalePointKind, { count: number; amount: number }>();

  for (const payment of payments) {
    const method = byMethod.get(payment.method) ?? { count: 0, amount: 0 };
    byMethod.set(payment.method, {
      count: method.count + 1,
      amount: method.amount + payment.grandTotal,
    });

    const kind = payment.tableSession.table.kind;
    const channel = byChannel.get(kind) ?? { count: 0, amount: 0 };
    byChannel.set(kind, { count: channel.count + 1, amount: channel.amount + payment.grandTotal });
  }

  const staffMeals = payments.filter((payment) => payment.staffCustomerId !== null);

  /**
   * เมนูขายดี "วันนี้" นับจากรายการที่ **ส่งเข้าครัวแล้ว** ไม่ใช่ที่จ่ายเงินแล้ว
   *
   * เพราะของที่ทำไปแล้วมีต้นทุนไปแล้วไม่ว่าบิลจะปิดหรือยัง และร้านที่ยังเปิดอยู่
   * ตอนดูจอนี้จะมีบิลค้างเสมอ — นับเฉพาะที่จ่ายแล้วจะทำให้ช่วงเย็นดูเหมือนขายไม่ออก
   * (ตัดรายการที่ถูกยกเลิกทิ้ง เพราะของถูกทิ้งไม่ใช่ของที่ขายได้)
   */
  const topItemRows = await prisma.orderItem.groupBy({
    by: ["nameSnapshot"],
    where: {
      branchId,
      status: { not: "CANCELLED" },
      order: {
        status: { notIn: ["DRAFT", "CANCELLED"] },
        placedAt: { gte: today.gte, lt: today.lt },
      },
    },
    _sum: { quantity: true, lineTotal: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 5,
  });

  const kitchenPending = kitchenItems
    .filter((row) => row.status !== "READY")
    .reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
  const kitchenReady = kitchenItems
    .filter((row) => row.status === "READY")
    .reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);

  return {
    /** วันของสาขาที่ตัวเลขชุดนี้อ้างถึง (YYYY-MM-DD) — ต้องขึ้นบนจอเสมอ */
    day: today.ymd,
    currency: staff.branch.currency,

    sales: {
      total: salesTotal,
      billCount: payments.length,
      /** ยอดเฉลี่ยต่อบิล — ปัดลงเป็นจำนวนเต็มหน่วยย่อย ไม่ใช้ float (กฎเรื่องเงิน) */
      average: payments.length > 0 ? Math.trunc(salesTotal / payments.length) : 0,
      byMethod: [...byMethod.entries()].map(([method, value]) => ({ method, ...value })),
      byChannel: [...byChannel.entries()].map(([kind, value]) => ({ kind, ...value })),
      staffMeal: {
        billCount: staffMeals.length,
        discountAmount: staffMeals.reduce((sum, payment) => sum + payment.discountAmount, 0),
      },
    },

    now: {
      openBills: openSessions.length,
      openDineIn: openSessions.filter((session) => session.table.kind === "DINE_IN").length,
      openTakeaway: openSessions.filter((session) => session.table.kind !== "DINE_IN").length,
      /** ยอดที่ยังไม่ได้เก็บของบิลที่เปิดอยู่ — ค่าอาหารดิบ ยังไม่บวก VAT/ค่าบริการ */
      openSubtotal: openSessions.reduce(
        (sum, session) =>
          sum +
          session.orders
            .filter((order) => order.status !== "DRAFT" && order.status !== "CANCELLED")
            .reduce((orderSum, order) => orderSum + order.subtotal, 0),
        0,
      ),
      kitchenPending,
      kitchenReady,
      activeStaffSessions: activeSessions,
    },

    topItems: topItemRows.map((row) => ({
      name: row.nameSnapshot,
      quantity: row._sum.quantity ?? 0,
      amount: row._sum.lineTotal ?? 0,
    })),

    /** จำนวนเหตุการณ์ที่ต้องจับตาวันนี้ (ยกเลิกรายการ · ติดธงส่วนลด · แก้อัตราภาษี ฯลฯ) */
    sensitiveEvents,
  };
}
