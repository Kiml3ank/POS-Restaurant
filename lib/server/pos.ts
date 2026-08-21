import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { canCancelOrderItem } from "@/lib/rbac";
import { recalculateOrderSubtotal } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { openOrJoinTableSession } from "@/lib/server/table-session";

/**
 * ข้อมูลและคำสั่งฝั่งเครื่องพนักงาน (บทที่ 9)
 *
 * ขอบเขตของก้อนนี้: ผังโต๊ะ, เปิด/ปิดรอบโต๊ะ, ดูบิลของโต๊ะ, สั่งแทนลูกค้า,
 * ยกเลิกรายการพร้อมเหตุผล — **ยังไม่รวมย้าย/รวมโต๊ะและแยกบิล** ซึ่งจะทำก้อนถัดไป
 * และต้องเป็น transaction เดียวที่ย้ายออร์เดอร์ทั้งชุด ไม่ใช่แค่เปลี่ยนเลขโต๊ะ
 *
 * ทุกฟังก์ชันในไฟล์นี้รับ `staff` ที่ผ่านการล็อกอินมาแล้วเสมอ และกรองด้วย
 * `staff.branchId` ทุก query — พนักงานสาขา A ต้องมองไม่เห็นโต๊ะของสาขา B
 */

/** บิลที่ยัง "มีชีวิต" อยู่บนโต๊ะ — ตะกร้าที่ยังไม่ส่ง + ของที่ส่งเข้าครัวแล้วแต่ยังไม่จ่าย */
const LIVE_ORDER_STATUSES = ["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED"] as const;

const POS_ORDER_INCLUDE = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      modifiers: { orderBy: { nameSnapshot: "asc" } },
      station: { select: { name: true } },
    },
  },
  placedByStaff: { select: { name: true } },
} satisfies Prisma.OrderInclude;

export type PosTableSummary = Awaited<ReturnType<typeof getPosTables>>[number];
export type PosTableDetail = NonNullable<Awaited<ReturnType<typeof getPosTable>>>;
export type PosOrder = PosTableDetail["orders"][number];

/**
 * ผังโต๊ะทั้งสาขา — หน้าจอแรกที่พนักงานเห็น
 *
 * ดึงรอบที่เปิดอยู่พร้อมบิลมาในคำสั่งเดียว แล้วสรุปยอดในหน่วยความจำ
 * (จำนวนโต๊ะต่อสาขาเป็นหลักสิบ ไม่ใช่หลักหมื่น การ aggregate ใน SQL แยกอีกรอบ
 * จะซับซ้อนกว่าโดยไม่ได้เร็วขึ้นจริง)
 */
export async function getPosTables(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      sessions: {
        where: { status: "OPEN", expiresAt: { gt: new Date() } },
        orderBy: { openedAt: "desc" },
        take: 1,
        include: {
          orders: {
            where: { status: { in: [...LIVE_ORDER_STATUSES] } },
            include: { items: { select: { status: true, quantity: true } } },
          },
        },
      },
    },
  });

  return tables.map((table) => {
    const session = table.sessions[0] ?? null;
    const orders = session?.orders ?? [];
    const items = orders.flatMap((order) => order.items);

    return {
      id: table.id,
      name: table.name,
      tableCode: table.tableCode,
      seats: table.seats,
      status: table.status,
      session: session && {
        id: session.id,
        pax: session.pax,
        openedAt: session.openedAt,
      },
      /** ยอดค่าอาหารสะสมของรอบนี้ (ยังไม่รวมเซอร์วิสชาร์จ/VAT — บทที่ 10) */
      runningTotal: orders.reduce((sum, order) => sum + order.subtotal, 0),
      draftCount: orders.filter((order) => order.status === "DRAFT").length,
      /** จำนวนชิ้นที่ครัวยังทำไม่เสร็จ — ตัวเลขที่พนักงานเสิร์ฟต้องจับตา */
      pendingItems: items
        .filter((item) => item.status === "PLACED" || item.status === "IN_PROGRESS")
        .reduce((sum, item) => sum + item.quantity, 0),
      readyItems: items
        .filter((item) => item.status === "READY")
        .reduce((sum, item) => sum + item.quantity, 0),
    };
  });
}

/** โต๊ะหนึ่งโต๊ะพร้อมรอบที่เปิดอยู่และบิลทั้งหมดของรอบนั้น */
export async function getPosTable(branchId: string, tableId: string) {
  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId, isActive: true },
  });

  if (!table) {
    return null;
  }

  const session = await prisma.tableSession.findFirst({
    where: { tableId: table.id, status: "OPEN", expiresAt: { gt: new Date() } },
    orderBy: { openedAt: "desc" },
  });

  const orders = session
    ? await prisma.order.findMany({
        where: { tableSessionId: session.id },
        orderBy: { createdAt: "asc" },
        include: POS_ORDER_INCLUDE,
      })
    : [];

  return {
    table,
    session,
    orders,
    /** ยอดรวมของบิลที่ยังไม่ถูกยกเลิก — ตัวเลขที่จะกลายเป็นฐานของบทที่ 10 */
    runningTotal: orders
      .filter((order) => order.status !== "CANCELLED")
      .reduce((sum, order) => sum + order.subtotal, 0),
  };
}

/** เปิดโต๊ะให้ลูกค้าจากเครื่อง POS (หรือเข้าร่วมรอบที่เปิดค้างอยู่) */
export async function openTableByStaff(staff: CurrentStaff, tableId: string, pax: number) {
  if (!Number.isFinite(pax) || pax < 1 || pax > 50) {
    return { ok: false as const, error: "จำนวนลูกค้าต้องอยู่ระหว่าง 1 ถึง 50 คน" };
  }

  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId: staff.branchId, isActive: true },
  });

  if (!table) {
    return { ok: false as const, error: "ไม่พบโต๊ะนี้ในสาขาของคุณ" };
  }

  const session = await openOrJoinTableSession({
    tableId: table.id,
    branchId: staff.branchId,
    pax,
    openedByStaffId: staff.id,
  });

  return { ok: true as const, session };
}

/**
 * ปิดรอบโต๊ะโดยที่ยังไม่ได้รับเงิน
 *
 * ใช้กับเคส "ลูกค้าลุกไปโดยไม่ได้สั่งอะไร" หรือ "เปิดโต๊ะผิดใบ" เท่านั้น
 * จึงยอมให้ปิดได้เฉพาะรอบที่ไม่มีบิลค้างที่ส่งเข้าครัวไปแล้ว —
 * การปิดรอบที่มีของค้างต้องผ่านการ "จ่ายเงิน" ในบทที่ 10 เสมอ ไม่งั้นตรงนี้
 * จะกลายเป็นช่องให้ล้างบิลทิ้งโดยไม่มีร่องรอย (เคสโกงในบทที่ 13)
 */
export async function closeTableSession(staff: CurrentStaff, sessionId: string, reason: string) {
  const note = reason.trim();

  if (note.length < 3) {
    return { ok: false as const, error: "กรุณากรอกเหตุผลอย่างน้อย 3 ตัวอักษร" };
  }

  const session = await prisma.tableSession.findFirst({
    where: { id: sessionId, branchId: staff.branchId, status: "OPEN" },
    include: { orders: { where: { status: { not: "CANCELLED" } }, select: { id: true, status: true } } },
  });

  if (!session) {
    return { ok: false as const, error: "ไม่พบรอบโต๊ะที่เปิดอยู่" };
  }

  const sentToKitchen = session.orders.filter((order) => order.status !== "DRAFT");

  if (sentToKitchen.length > 0) {
    return {
      ok: false as const,
      error: "โต๊ะนี้มีบิลที่ส่งเข้าครัวแล้ว ต้องคิดเงินก่อน (ฟังก์ชันคิดเงินอยู่ในบทที่ 10)",
    };
  }

  await prisma.$transaction(async (tx) => {
    // ตะกร้าที่ยังไม่ได้ส่ง (DRAFT) ทิ้งไปพร้อมรอบได้ เพราะยังไม่มีของถูกทำจริง
    await tx.order.deleteMany({ where: { tableSessionId: session.id, status: "DRAFT" } });

    await tx.tableSession.update({
      where: { id: session.id },
      data: { status: "ABANDONED", closedAt: new Date() },
    });

    await tx.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: "AVAILABLE" },
    });

    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "table_session.abandon",
        entityType: "table_session",
        entityId: session.id,
        metadata: { reason: note, tableId: session.tableId },
      },
    });
  });

  return { ok: true as const };
}

/**
 * ยกเลิกรายการอาหารหนึ่งบรรทัด
 *
 * เป็นจุดที่เล่มเตือนไว้ตรง ๆ ว่าโกงกันบ่อยที่สุด กติกาที่ตั้งไว้จึงเป็น:
 *   - จำกัดตามตำแหน่ง (พนักงานเสิร์ฟยกเลิกเองไม่ได้)
 *   - บังคับกรอกเหตุผล ไม่มีทางลัด
 *   - เขียน AuditLog พร้อม snapshot ของสถานะและยอดเงิน ณ ตอนที่กด
 *     ในtransaction เดียวกับการยกเลิก — ยกเลิกสำเร็จแต่ log หายไม่ได้
 */
export async function cancelOrderItemByStaff(
  staff: CurrentStaff,
  orderItemId: string,
  reason: string,
) {
  if (!canCancelOrderItem(staff.role)) {
    return { ok: false as const, error: "ตำแหน่งของคุณไม่มีสิทธิ์ยกเลิกรายการ กรุณาเรียกผู้จัดการ" };
  }

  const note = reason.trim();

  if (note.length < 3) {
    return { ok: false as const, error: "กรุณากรอกเหตุผลอย่างน้อย 3 ตัวอักษร" };
  }

  const item = await prisma.orderItem.findFirst({
    where: { id: orderItemId, branchId: staff.branchId, status: { not: "CANCELLED" } },
    include: { order: { select: { id: true, status: true, orderNumber: true } } },
  });

  if (!item) {
    return { ok: false as const, error: "ไม่พบรายการนี้ หรือถูกยกเลิกไปแล้ว" };
  }

  if (item.order.status === "PAID") {
    return { ok: false as const, error: "บิลนี้จ่ายเงินแล้ว ยกเลิกรายการไม่ได้" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.update({
      where: { id: item.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: note },
    });

    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "order_item.cancel",
        entityType: "order_item",
        entityId: item.id,
        metadata: {
          reason: note,
          orderNumber: item.order.orderNumber,
          itemName: item.nameSnapshot,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
          statusBefore: item.status,
        },
      },
    });

    await recalculateOrderSubtotal(tx, item.orderId);
  });

  return { ok: true as const };
}
