import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { canCancelOrderItem } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION, type RealtimeEventType } from "@/lib/realtime-events";
import { needsQueueNumber } from "@/lib/sale-point";
import { getSessionBill } from "@/lib/server/billing";
import { recalculateOrderSubtotal } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { syncOrderStatusFromItems } from "@/lib/server/order-progress";
import { publishRealtimeEvent } from "@/lib/server/realtime";
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
    /**
     * ผังโต๊ะแสดงเฉพาะ "โต๊ะนั่ง"
     *
     * เคาน์เตอร์ซื้อกลับกับช่องไรเดอร์เป็นแถวในตารางเดียวกัน แต่ตอบคำถามของ
     * หน้านี้ ("โต๊ะไหนว่าง") ไม่ได้ เพราะมีบิลเปิดพร้อมกันได้หลายใบ —
     * บิลซื้อกลับที่ยังไม่ปิดจะโผล่เป็นแถบคิวแยก ไม่ใช่ช่องในผัง
     *
     * เงื่อนไขนี้ต้องตรงกับ showsInTableMap() ใน lib/sale-point.ts เสมอ
     */
    where: { branchId, isActive: true, kind: "DINE_IN" },
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

/**
 * โต๊ะหนึ่งโต๊ะพร้อมรอบที่เปิดอยู่และบิลทั้งหมดของรอบนั้น
 *
 * ⚠ ใช้ได้เฉพาะจุดขายที่มีรอบเปิดได้ทีละรอบ (โต๊ะนั่ง) — เคาน์เตอร์ซื้อกลับ
 * มีหลายรอบพร้อมกัน แล้วตัวนี้จะคืน "รอบล่าสุด" เสมอ ซึ่งเป็นคนละใบกับที่
 * พนักงานกำลังกดอยู่ ใช้ `getPosSession()` แทน
 */
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

  return buildPosDetail(table, session);
}

/**
 * รอบขายใบใดใบหนึ่งพร้อมบิลทั้งหมดของรอบนั้น — ทางเข้าของจุดขายที่มีหลายบิลพร้อมกัน
 *
 * คืนรูปร่างเดียวกับ `getPosTable()` เป๊ะ ๆ เพื่อให้หน้าจอตัวเดียวกัน
 * (`SalePointScreen`) render ได้ทั้งสองทางโดยไม่ต้องมี branch ข้างใน
 *
 * รับเฉพาะรอบที่ **ยังเปิดอยู่** — รอบที่ปิดแล้วคือบิลที่จ่ายเงินไปแล้ว
 * ต้องไปดูที่ใบเสร็จ (บทที่ 12) ไม่ใช่กลับมาสั่งของเพิ่มในรอบที่ปิดไปแล้ว
 */
export async function getPosSession(branchId: string, sessionId: string) {
  const session = await prisma.tableSession.findFirst({
    where: { id: sessionId, branchId, status: "OPEN", expiresAt: { gt: new Date() } },
  });

  if (!session) {
    return null;
  }

  const table = await prisma.restaurantTable.findFirst({
    where: { id: session.tableId, branchId, isActive: true },
  });

  if (!table) {
    return null;
  }

  return buildPosDetail(table, session);
}

/**
 * บิลซื้อกลับ/ไรเดอร์ที่ยังไม่ปิด ทั้งสาขา — "แถบคิว"
 *
 * ── ทำไมต้องมีฟังก์ชันนี้ ────────────────────────────────────────────────
 * จุดขายที่ไม่ใช่โต๊ะนั่งถูกกรองออกจากผังโต๊ะไปแล้ว (`getPosTables()`)
 * ถ้าไม่มีทางเข้านี้ **บิลซื้อกลับที่เปิดค้างอยู่จะมองไม่เห็นจากหน้าจอไหนเลย**
 * — ของถูกทำเสร็จแล้ววางรอ แต่ไม่มีใครรู้ว่ามีบิลค้าง
 *
 * เรียงตามเลขคิวจากน้อยไปมาก = ลำดับที่ลูกค้ามาถึงจริง (คนที่รอนานที่สุดอยู่บนสุด)
 * ไม่ใช่เรียงตามเวลาที่เปิดล่าสุดแบบผังโต๊ะ
 */
export async function getOpenSalePointSessions(branchId: string) {
  const sessions = await prisma.tableSession.findMany({
    where: {
      branchId,
      status: "OPEN",
      expiresAt: { gt: new Date() },
      table: { kind: { not: "DINE_IN" } },
    },
    orderBy: [{ queueDay: "asc" }, { queueNumber: "asc" }],
    include: {
      table: { select: { id: true, name: true, kind: true } },
      orders: {
        where: { status: { in: [...LIVE_ORDER_STATUSES] } },
        include: { items: { select: { status: true, quantity: true } } },
      },
    },
  });

  return sessions.map((session) => {
    const items = session.orders.flatMap((order) => order.items);

    return {
      id: session.id,
      queueNumber: session.queueNumber,
      customerName: session.customerName,
      openedAt: session.openedAt,
      table: session.table,
      runningTotal: session.orders
        .filter((order) => order.status !== "DRAFT")
        .reduce((sum, order) => sum + order.subtotal, 0),
      /** ตะกร้าที่ยังไม่ได้กดส่งเข้าครัว — บิลที่ค้างตรงนี้คือของที่ครัวยังไม่รู้เลยว่ามี */
      draftCount: session.orders.filter((order) => order.status === "DRAFT").length,
      readyItems: items
        .filter((item) => item.status === "READY")
        .reduce((sum, item) => sum + item.quantity, 0),
      pendingItems: items
        .filter((item) => item.status === "PLACED" || item.status === "IN_PROGRESS")
        .reduce((sum, item) => sum + item.quantity, 0),
    };
  });
}

export type SalePointQueueEntry = Awaited<ReturnType<typeof getOpenSalePointSessions>>[number];

/**
 * ปลายทางที่ย้าย/รวมโต๊ะไปได้ — แยกสองกลุ่มเพราะเป็นคนละการกระทำ
 *
 * `free` = โต๊ะว่าง → **ย้าย** (ปลอดภัย ย้อนกลับได้ด้วยการย้ายกลับ)
 * `occupied` = โต๊ะที่มีบิลเปิดอยู่ → **รวม** (แยกกลับไม่ได้)
 *
 * กลุ่มหลังแนบ `total` มาด้วยเสมอ เพราะคนกดต้องเห็นว่ากำลังจะรวมเงินก้อนไหน
 * เข้ากับก้อนไหน — ปุ่มที่บอกแค่ชื่อโต๊ะทำให้กดผิดโต๊ะแล้วรู้ตัวตอนคิดเงินแล้ว
 */
export async function getMoveTargets(branchId: string, currentTableId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, isActive: true, kind: "DINE_IN", id: { not: currentTableId } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      sessions: {
        where: { status: "OPEN" },
        orderBy: { openedAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  const free: { id: string; name: string }[] = [];
  const occupied: { id: string; name: string; sessionId: string; total: number }[] = [];

  for (const table of tables) {
    const open = table.sessions[0];

    if (!open) {
      free.push({ id: table.id, name: table.name });
      continue;
    }

    // ยอดจาก getSessionBill() ตัวเดียวกับที่หน้าคิดเงินใช้ ไม่ได้บวกเอาเองที่นี่
    const bill = await getSessionBill(branchId, open.id);

    occupied.push({
      id: table.id,
      name: table.name,
      sessionId: open.id,
      total: bill?.bill.grandTotal ?? 0,
    });
  }

  return { free, occupied };
}

/**
 * เปิดบิลซื้อกลับใบใหม่ที่จุดขายที่ไม่ใช่โต๊ะนั่ง
 *
 * แยกจาก `openTableByStaff()` เพราะความหมายต่างกันจริง ไม่ใช่แค่ชื่อ:
 * เปิดโต๊ะต้องกรอกจำนวนคนและ "เข้าร่วมรอบเดิมถ้ามี" · เปิดบิลซื้อกลับไม่มี
 * จำนวนคนให้กรอก (ลูกค้าไม่ได้นั่ง) และ **ต้องได้ใบใหม่เสมอ** ซึ่ง
 * `openOrJoinTableSession()` จัดการให้แล้วตาม `kind` ของจุดขาย
 *
 * ปฏิเสธจุดขายที่เป็นโต๊ะนั่งโดยตั้งใจ — ถ้าปล่อยผ่าน จะเปิดบิลซ้อนบนโต๊ะที่
 * ลูกค้านั่งอยู่ได้ แล้วบิลของโต๊ะนั้นจะแตกเป็นสองใบโดยไม่มีใครตั้งใจ
 */
export async function openSalePointSession(staff: CurrentStaff, tableId: string) {
  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId: staff.branchId, isActive: true },
  });

  if (!table) {
    return { ok: false as const, error: "ไม่พบจุดขายนี้ในสาขาของคุณ" };
  }

  if (table.kind === "DINE_IN") {
    return { ok: false as const, error: "จุดขายนี้เป็นโต๊ะนั่ง ให้เปิดโต๊ะจากผังโต๊ะแทน" };
  }

  const session = await openOrJoinTableSession({
    tableId: table.id,
    branchId: staff.branchId,
    pax: 1,
    openedByStaffId: staff.id,
  });

  await announce("table_session.changed", staff.branchId, table.id);

  return { ok: true as const, session };
}

/**
 * ความยาวสูงสุดของชื่อลูกค้า — สั้นพอที่จะไม่ดันหน้าจอแถบคิวเสียรูป
 * และยาวพอสำหรับ "คุณนัท ตึกฝั่งตรงข้าม" ที่พนักงานจดจริง
 */
export const CUSTOMER_NAME_MAX_LENGTH = 40;

/**
 * ตั้งชื่อลูกค้าของรอบขาย (ช่องทางที่ไม่ใช่โต๊ะนั่ง)
 *
 * ── ทำไมต้องมีทั้งที่มีเลขคิวแล้ว ────────────────────────────────────────
 * เลขคิวใช้เรียกของได้ก็จริง แต่ร้านจริงเรียกชื่อเมื่อคิวชนกันหลายเจ้าหรือ
 * ลูกค้าประจำสั่งทางโทรศัพท์ไว้ก่อน — ชื่อจึงเป็นของ **เพิ่มเติม** ไม่ใช่ของบังคับ
 * (ฟอร์มตอนเปิดบิลไม่ถามอะไรเลยโดยตั้งใจ ดู archive/report/2026-08-24-takeaway-screens.md)
 *
 * ── กติกา ────────────────────────────────────────────────────────────────
 * - ตั้งได้เฉพาะรอบที่ **ยังเปิดอยู่** ในสาขาของพนักงานคนนั้น
 * - ส่งค่าว่างมา = ล้างชื่อทิ้ง (คืนเป็น null) ไม่ใช่เก็บสตริงว่าง —
 *   ทุกที่ที่แสดงผลเช็คด้วย `customerName ? ...` สตริงว่างจะกลายเป็นบรรทัดเปล่า
 * - โต๊ะนั่งไม่รับ เพราะชื่อโต๊ะทำหน้าที่นี้อยู่แล้ว และช่องกรอกที่ไม่มีใครใช้
 *   คือช่องที่พนักงานจะกรอกอะไรก็ได้ลงไป
 *
 * ไม่เขียน AuditLog เพราะไม่แตะเงินและไม่ใช่สิทธิ์พิเศษ — ต่างจากส่วนลดพนักงาน
 * ที่ต้องมีเสมอ (ดู lib/server/staff-meal.ts)
 */
export async function setSessionCustomerName(
  staff: CurrentStaff,
  sessionId: string,
  rawName: string,
) {
  const session = await prisma.tableSession.findFirst({
    where: { id: sessionId, branchId: staff.branchId, status: "OPEN" },
    include: { table: { select: { id: true, kind: true } } },
  });

  if (!session) {
    return { ok: false as const, error: "ไม่พบบิลที่เปิดอยู่ใบนี้ในสาขาของคุณ" };
  }

  if (!needsQueueNumber(session.table.kind)) {
    return { ok: false as const, error: "บิลของโต๊ะนั่งใช้ชื่อโต๊ะเรียกอยู่แล้ว" };
  }

  const name = rawName.trim();

  if (name.length > CUSTOMER_NAME_MAX_LENGTH) {
    return {
      ok: false as const,
      error: `ชื่อลูกค้ายาวเกิน ${CUSTOMER_NAME_MAX_LENGTH} ตัวอักษร`,
    };
  }

  await prisma.tableSession.update({
    where: { id: session.id },
    data: { customerName: name.length > 0 ? name : null },
  });

  await announce("table_session.changed", staff.branchId, session.table.id);

  return { ok: true as const, customerName: name.length > 0 ? name : null };
}

/** จุดขายที่ไม่ใช่โต๊ะนั่งทั้งหมดของสาขา — ใช้เลือกว่าจะเปิดบิลใหม่ที่ช่องไหน */
export async function getSalePoints(branchId: string) {
  return prisma.restaurantTable.findMany({
    where: { branchId, isActive: true, kind: { not: "DINE_IN" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true },
  });
}

/** แกนกลางที่ทั้งสองทางเข้าด้านบนใช้ร่วมกัน — รูปร่างผลลัพธ์ต้องเหมือนกันเสมอ */
async function buildPosDetail(
  table: Prisma.RestaurantTableGetPayload<object>,
  session: Prisma.TableSessionGetPayload<object> | null,
) {
  const orders = session
    ? await prisma.order.findMany({
        where: { tableSessionId: session.id },
        orderBy: { createdAt: "asc" },
        include: POS_ORDER_INCLUDE,
      })
    : [];

  /**
   * จำนวนรอบที่เปิดอยู่ของ "จุดขาย" นี้ (ไม่ใช่ของรอบที่เลือกมา)
   *
   * โต๊ะนั่งเป็น 0 หรือ 1 เสมอ · เคาน์เตอร์เป็นเท่าไหร่ก็ได้ — ตัวเลขนี้คือสิ่งที่
   * ทำให้ผู้เรียกรู้ว่า "การเดาว่าเป็นรอบไหน" ปลอดภัยหรือเปล่า โดยไม่ต้องยิง
   * query เองอีกรอบ (`resolveOpenSession()` ใน actions.ts ใช้ตัวนี้)
   */
  const openSessionCount = await prisma.tableSession.count({
    where: { tableId: table.id, status: "OPEN", expiresAt: { gt: new Date() } },
  });

  return {
    table,
    session,
    orders,
    /** ยอดรวมของบิลที่ยังไม่ถูกยกเลิก — ตัวเลขที่จะกลายเป็นฐานของบทที่ 10 */
    runningTotal: orders
      .filter((order) => order.status !== "CANCELLED")
      .reduce((sum, order) => sum + order.subtotal, 0),
    openSessionCount,
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

  await announce("table_session.changed", staff.branchId, table.id);

  return { ok: true as const, session };
}

/**
 * ปิดรอบโต๊ะโดยที่ยังไม่ได้รับเงิน
 *
 * ใช้กับเคส "ลูกค้าลุกไปโดยไม่ได้สั่งอะไร" หรือ "เปิดโต๊ะผิดใบ" เท่านั้น
 * จึงยอมให้ปิดได้เฉพาะรอบที่ไม่มีบิลค้างที่ส่งเข้าครัวไปแล้ว —
 * การปิดรอบที่มีของค้างต้องผ่าน `takePayment()` (บทที่ 11) เสมอ ไม่งั้นตรงนี้
 * จะกลายเป็นช่องให้ล้างบิลทิ้งโดยไม่มีร่องรอย (เคสโกงในบทที่ 13)
 *
 * ต่างกันที่ปลายทางด้วย: ที่นี่ปิดเป็น `ABANDONED` ส่วนการรับเงินปิดเป็น `CLOSED`
 * — รายงานบทที่ 15 ต้องแยกสองอย่างนี้ออกจากกันได้ (โต๊ะที่ลูกค้าหนีบิล ไม่ใช่โต๊ะที่ขายได้)
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
      error: "โต๊ะนี้มีบิลที่ส่งเข้าครัวแล้ว ต้องรับเงินปิดบิลที่หน้าคิดเงินก่อน",
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

  await announce("table_session.changed", staff.branchId, session.tableId);

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
    include: { order: { select: { id: true, status: true, orderNumber: true, tableId: true } } },
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

    /**
     * ยกเลิกรายการแล้วสถานะบิลต้องขยับตามด้วย ในtransaction เดียวกัน (บทที่ 8)
     *
     * เคสที่ทำให้ต้องมีบรรทัดนี้: บิลมีสองรายการ น้ำเสิร์ฟไปแล้ว ข้าวผัดยังไม่ได้ทำ
     * แล้วผู้จัดการยกเลิกข้าวผัดทิ้ง — ถ้าไม่ roll-up บิลจะค้างเป็น PLACED
     * ตลอดไปทั้งที่ไม่เหลืออะไรให้ครัวทำ แล้วโต๊ะนั้นจะคิดเงินไม่ได้ในบทที่ 10
     * (เพราะเงื่อนไขปิดบิลคือ SERVED → PAID)
     *
     * และถ้ายกเลิกจนหมดทั้งใบ บิลจะกลายเป็น CANCELLED เองโดยไม่ต้องมีปุ่มแยก
     */
    await syncOrderStatusFromItems(tx, item.orderId);
  });

  await announce("order_item.cancelled", staff.branchId, item.order.tableId);

  return { ok: true as const };
}

/** ยิง event realtime หลัง commit — เหตุผลและรูปแบบเดียวกับใน lib/server/cart.ts */
async function announce(type: RealtimeEventType, branchId: string, tableId: string | null) {
  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type,
    branchId,
    tableId,
    at: Date.now(),
  });
}
