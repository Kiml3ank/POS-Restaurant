import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { OrderItemStatus } from "@/lib/generated/prisma/enums";
import {
  KITCHEN_ITEM_STATUSES,
  KITCHEN_NEXT_STATUS,
  canTransitionOrderItem,
  isKitchenActionable,
} from "@/lib/order-status";
import { canCookOrderItem, canServeOrderItem } from "@/lib/rbac";
import { prisma } from "@/lib/server/db";
import { syncOrderStatusFromItems } from "@/lib/server/order-progress";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";

/**
 * จอครัว KDS (บทที่ 8)
 *
 * ── กฎที่ตัดสินหน้าตาของไฟล์นี้ทั้งไฟล์ ────────────────────────────────────
 *
 * 1. **กรองด้วย `OrderItem.stationId` ที่ snapshot ไว้ตอนสั่ง ห้าม join เมนูสด**
 *    ถ้าไปอ่าน `MenuItem.stationId` ตอนแสดงผล วันที่ผู้จัดการย้าย "ผัดกะเพรา"
 *    จากครัวร้อนไปครัวทอด ออร์เดอร์ที่ครัวร้อนกำลังผัดอยู่จะหายไปจากจอกลางคัน
 *    แล้วโผล่ที่ครัวทอดแทน ค่าที่ถูกคือค่า ณ ตอนที่กดสั่ง ซึ่งอยู่ใน OrderItem แล้ว
 *
 * 2. **รายการที่ `stationId = null` ต้องไม่ขึ้นจอครัวเลย**
 *    คือของที่หยิบเองไม่ต้องผ่านครัว (น้ำเปล่าขวด ขนมซอง) ถ้าปล่อยขึ้นจอ
 *    ครัวจะต้องคอยกดปิดของที่ตัวเองไม่ได้ทำ ทั้งวัน
 *
 * 3. ครัวเดินได้แค่ PLACED → IN_PROGRESS → READY (ดู KITCHEN_NEXT_STATUS)
 *    การกด "เสิร์ฟแล้ว" เป็นของพนักงานเสิร์ฟ ไม่ใช่ครัว
 */

/** จำนวนบิลสูงสุดที่ดึงมาแสดงต่อครั้ง — กันจอค้างตอนร้านแน่นและมีบิลค้างเป็นร้อย */
const MAX_TICKETS = 60;

export type KitchenStation = Awaited<ReturnType<typeof getKitchenStations>>[number];
export type KitchenTicket = Awaited<ReturnType<typeof getKitchenTickets>>[number];
export type KitchenTicketItem = KitchenTicket["items"][number];

/** สถานีทั้งหมดของสาขา + จำนวนงานที่ค้างอยู่ในแต่ละสถานี (ใช้ทำแท็บด้านบนจอ) */
export async function getKitchenStations(branchId: string) {
  const stations = await prisma.station.findMany({
    where: { branchId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true },
  });

  // นับทีเดียวทุกสถานีแล้วค่อยจับคู่ในหน่วยความจำ — ถูกกว่ายิง count ทีละสถานี
  const counts = await prisma.orderItem.groupBy({
    by: ["stationId", "status"],
    where: {
      branchId,
      stationId: { not: null },
      status: { in: [...KITCHEN_ITEM_STATUSES] },
    },
    _count: { _all: true },
  });

  return stations.map((station) => {
    const forStation = counts.filter((row) => row.stationId === station.id);
    const countOf = (status: OrderItemStatus) =>
      forStation.find((row) => row.status === status)?._count._all ?? 0;

    return {
      ...station,
      queued: countOf("PLACED"),
      cooking: countOf("IN_PROGRESS"),
      ready: countOf("READY"),
    };
  });
}

/**
 * ใบสั่งที่ยังอยู่ในมือครัว เรียงเก่าไปใหม่ (คิวจริงของครัวคือ FIFO ตามเวลาที่กดส่ง)
 *
 * หนึ่ง "ใบ" = หนึ่ง Order ที่ยังมีรายการของสถานีที่กำลังดูอยู่ค้างอยู่
 * บิลที่รายการของสถานีนี้เสิร์ฟครบแล้วจะหลุดออกจากจอเอง แม้สถานีอื่นจะยังทำไม่เสร็จ
 */
export async function getKitchenTickets(
  branchId: string,
  options: { stationId?: string | null } = {},
) {
  /**
   * ตัวกรองชุดเดียวใช้สองที่: กรองว่า "บิลไหนมีของของสถานีนี้" (where.items.some)
   * และกรองว่า "ในบิลนั้นเอาบรรทัดไหนมาโชว์" (select.items.where)
   *
   * ต้องเป็นตัวเดียวกันเป๊ะ ๆ ไม่งั้นจะได้บิลที่ผ่านด่านแรกมาแต่ไม่มีบรรทัดให้แสดง
   * — จอครัวจะขึ้นการ์ดเปล่า ๆ ที่กดอะไรไม่ได้
   */
  const itemFilter: Prisma.OrderItemWhereInput = {
    // stationId: null = ของที่ไม่ต้องผ่านครัว ต้องไม่โผล่ที่นี่ (กฎข้อ 2 ด้านบน)
    stationId: options.stationId ? options.stationId : { not: null },
    status: { in: [...KITCHEN_ITEM_STATUSES] },
  };

  const orders = await prisma.order.findMany({
    where: {
      branchId,
      /**
       * กรองด้วยสถานะ **บิล** แค่พอให้ของที่ไม่ใช่งานครัวหลุดออกไป — ตะกร้าที่ยัง
       * ไม่ได้กดส่ง (DRAFT) กับบิลที่ยกเลิกทั้งใบ (CANCELLED) เท่านั้น
       *
       * ⚠ ห้ามกลับไปเขียน `in: ["PLACED","IN_PROGRESS","READY"]` อีก: บิลที่จ่ายเงิน
       * แล้วจะเป็น PAID ทันที ตั๋วจึงหลุดจากจอครัวทั้งที่ของยังไม่ได้ทำ ซึ่งพังหนัก
       * ที่สุดกับเคาน์เตอร์ซื้อกลับที่ลูกค้า **จ่ายก่อนแล้วยืนรอ** (จ่ายแล้วแต่ครัว
       * ไม่เคยเห็นออร์เดอร์) ส่วนบิลที่ทำครบแล้วไม่ต้องกรองตรงนี้ เพราะรายการ
       * ทั้งหมดจะพ้น KITCHEN_ITEM_STATUSES ไปเองอยู่แล้ว — งานครัวจบที่ระดับ
       * "รายการ" เสมอ ไม่ใช่ที่ระดับ "บิล"
       */
      status: { notIn: ["DRAFT", "CANCELLED"] },
      items: { some: itemFilter },
    },
    // เรียงตามเวลาที่กดส่งเข้าครัว ไม่ใช่เวลาที่เปิดตะกร้า — โต๊ะที่เปิดตะกร้าค้างไว้
    // ตั้งแต่เที่ยงแล้วเพิ่งกดส่งตอนบ่ายสาม ต้องไปต่อท้ายคิว ไม่ใช่แซงขึ้นหัว
    orderBy: [{ placedAt: "asc" }, { createdAt: "asc" }],
    take: MAX_TICKETS,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      channel: true,
      note: true,
      placedAt: true,
      createdAt: true,
      table: { select: { id: true, name: true, kind: true } },
      /**
       * เลขคิวของบิลซื้อกลับ — ครัวต้องเห็น "ซื้อกลับ คิว 12" ไม่ใช่ชื่อช่อง
       * ("เคาน์เตอร์ซื้อกลับ" เหมือนกันทุกใบ อ่านแล้วไม่รู้ว่าของใคร)
       */
      tableSession: { select: { queueNumber: true } },
      items: {
        where: itemFilter,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          nameSnapshot: true,
          quantity: true,
          status: true,
          note: true,
          stationId: true,
          station: { select: { id: true, name: true } },
          modifiers: {
            orderBy: { nameSnapshot: "asc" },
            select: { id: true, nameSnapshot: true },
          },
        },
      },
    },
  });

  /**
   * อ่านนาฬิกาครั้งเดียวตรงนี้ ไม่ใช่ในหน้าจอ
   *
   * สองเหตุผล: ทุกใบบนจอต้องวัดจากวินาทีเดียวกัน (ไม่งั้นใบท้าย ๆ จะดูใหม่กว่า
   * ใบแรกโดยไม่มีเหตุ) และ `Date.now()` เป็นฟังก์ชันไม่บริสุทธิ์ที่เรียกระหว่าง
   * render ของ React component ไม่ได้ — กฎ purity จับได้จริงตอน lint
   */
  const now = Date.now();

  return orders.map((order) => {
    const queuedAt = order.placedAt ?? order.createdAt;

    return {
      ...order,
      /** เวลาที่บิลนี้เข้าคิวครัว — ใช้คิดว่ารออยู่กี่นาทีแล้ว */
      queuedAt,
      /** รอมากี่นาทีแล้ว ณ ตอนที่ render ฝั่ง server (ฝั่ง client เดินต่อเอง) */
      waitedMinutes: Math.max(0, Math.floor((now - queuedAt.getTime()) / 60_000)),
      /** true เมื่อทุกรายการของสถานีนี้ทำเสร็จหมดแล้ว รอพนักงานมายก */
      allReady: order.items.every((item) => item.status === "READY"),
    };
  });
}

type KitchenResult = { ok: true; changed: number } | { ok: false; error: string };

/**
 * ครัวกดเปลี่ยนสถานะรายการเดียว
 *
 * `to` ไม่ได้รับมาจากหน้าจอโดยตรง — หน้าจอส่งมาแค่ว่า "กดปุ่มถัดไปของรายการนี้"
 * แล้วที่นี่เป็นคนหาเองว่าถัดไปคืออะไรจาก KITCHEN_NEXT_STATUS
 *
 * เหตุผล: จอครัวสองจอที่เปิดหน้าเดียวกันค้างไว้ ถ้าอีกจอกดไปก่อนแล้ว จอที่สอง
 * ยังถือ HTML เก่าที่เขียนว่า "รับออร์เดอร์" อยู่ ถ้าเชื่อค่าที่จอส่งมา รายการที่
 * กำลังทำอยู่จะถูกดันกลับไป IN_PROGRESS ซ้ำ — อ่านสถานะสดจาก DB แล้วคิดเองปลอดภัยกว่า
 */
export async function advanceKitchenItem(
  staff: CurrentStaff,
  orderItemId: string,
): Promise<KitchenResult> {
  if (!canCookOrderItem(staff.role)) {
    return { ok: false, error: "ปุ่มนี้เป็นของครัว ตำแหน่งของคุณกดแทนไม่ได้" };
  }

  const item = await prisma.orderItem.findFirst({
    where: { id: orderItemId, branchId: staff.branchId, stationId: { not: null } },
    select: { id: true, orderId: true, status: true, order: { select: { tableId: true } } },
  });

  if (!item) {
    return { ok: false, error: "ไม่พบรายการนี้ในสาขาของคุณ" };
  }

  if (!isKitchenActionable(item.status)) {
    // ไม่ถือเป็น error เพราะสาเหตุที่พบบ่อยที่สุดคืออีกจอกดไปแล้ว ซึ่งคือผลลัพธ์
    // ที่ต้องการอยู่แล้ว — ขึ้นข้อความแดงจะทำให้ครัวคิดว่ากดไม่ติดแล้วกดซ้ำอีก
    return { ok: true, changed: 0 };
  }

  const changed = await applyItemStatus(item.orderId, [item.id], item.status, {
    [item.status]: KITCHEN_NEXT_STATUS[item.status],
  });

  await publishItemStatusChanged(staff.branchId, item.order.tableId);

  return { ok: true, changed };
}

/**
 * "บั๊ม" ทั้งใบ — ดันทุกรายการของสถานีนี้ในบิลเดียวกันไปขั้นถัดไปพร้อมกัน
 *
 * ครัวจริงคิดเป็นใบ ไม่ได้คิดเป็นรายการ: ผัดกะเพราสามจานของโต๊ะเดียวกันลงกระทะ
 * พร้อมกันและเสร็จพร้อมกัน ถ้าไม่มีปุ่มนี้ ครัวต้องกดสามครั้งด้วยมือเปื้อนน้ำมัน
 *
 * รายการที่อยู่คนละขั้นกันในใบเดียวกัน (บางจานรับแล้ว บางจานยังไม่รับ) จะถูกดัน
 * ตามขั้นของตัวเองแต่ละตัว ไม่ใช่ยัดให้เท่ากันหมด
 */
export async function advanceKitchenTicket(
  staff: CurrentStaff,
  orderId: string,
  stationId: string | null,
): Promise<KitchenResult> {
  if (!canCookOrderItem(staff.role)) {
    return { ok: false, error: "ปุ่มนี้เป็นของครัว ตำแหน่งของคุณกดแทนไม่ได้" };
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, branchId: staff.branchId },
    select: {
      id: true,
      tableId: true,
      items: {
        where: {
          stationId: stationId ? stationId : { not: null },
          status: { in: ["PLACED", "IN_PROGRESS"] },
        },
        select: { id: true, status: true },
      },
    },
  });

  if (!order) {
    return { ok: false, error: "ไม่พบบิลนี้ในสาขาของคุณ" };
  }

  if (order.items.length === 0) {
    return { ok: true, changed: 0 };
  }

  /**
   * ดันทีละขั้น: รายการที่ยัง PLACED ไป IN_PROGRESS และที่ IN_PROGRESS ไป READY
   * ในคำสั่งเดียวกันสองก้อน — ตั้งใจไม่ให้ของที่ยังไม่ได้เริ่มทำกระโดดไป READY
   * เพราะเวลาที่เก็บได้จะกลายเป็นศูนย์ แล้วรายงาน "ครัวใช้เวลาเฉลี่ยกี่นาที"
   * ในบทที่ 15 จะเพี้ยนทั้งกะ
   */
  let changed = 0;

  for (const from of ["PLACED", "IN_PROGRESS"] as const) {
    const ids = order.items.filter((item) => item.status === from).map((item) => item.id);

    if (ids.length > 0) {
      changed += await applyItemStatus(order.id, ids, from, { [from]: KITCHEN_NEXT_STATUS[from] });
    }
  }

  await publishItemStatusChanged(staff.branchId, order.tableId);

  return { ok: true, changed };
}

/**
 * พนักงานเสิร์ฟกด "ยกไปเสิร์ฟแล้ว" — READY → SERVED
 *
 * อยู่ไฟล์เดียวกับ KDS เพราะเป็นการเดินบนเส้นทางเดียวกันและต้อง roll-up
 * สถานะบิลด้วยตรรกะชุดเดียวกัน แต่คนละสิทธิ์: ครัวกดไม่ได้ (ดู KITCHEN_NEXT_STATUS)
 */
export async function serveOrderItem(
  staff: CurrentStaff,
  orderItemId: string,
): Promise<KitchenResult> {
  if (!canServeOrderItem(staff.role)) {
    return { ok: false, error: "ตำแหน่งของคุณไม่มีสิทธิ์กดเสิร์ฟ" };
  }

  const item = await prisma.orderItem.findFirst({
    where: { id: orderItemId, branchId: staff.branchId },
    select: { id: true, orderId: true, status: true, order: { select: { tableId: true } } },
  });

  if (!item) {
    return { ok: false, error: "ไม่พบรายการนี้ในสาขาของคุณ" };
  }

  if (item.status !== "READY") {
    return { ok: true, changed: 0 };
  }

  const changed = await applyItemStatus(item.orderId, [item.id], "READY", { READY: "SERVED" });

  await publishItemStatusChanged(staff.branchId, item.order.tableId);

  return { ok: true, changed };
}

/**
 * แกนกลางของการเปลี่ยนสถานะรายการ — ที่เดียวที่เขียน OrderItem.status ในบทนี้
 *
 * สามอย่างที่ต้องเกิดพร้อมกันหรือไม่เกิดเลย จึงอยู่ใน `$transaction` เดียว:
 *   1. เปลี่ยนสถานะรายการ + ประทับเวลา
 *   2. roll-up สถานะของบิลจากรายการทั้งหมด
 * ถ้าแยกกันจะมีช่วงที่รายการเป็น READY ครบแล้วแต่หัวบิลยังเป็น PLACED ซึ่งเป็น
 * ช่วงที่ผังโต๊ะกับหน้าลูกค้าอ่านแล้วบอกคนละเรื่อง
 *
 * `where` ผูก `status: from` ไว้เสมอ — นี่คือชั้นกันสองจอกดพร้อมกันที่เชื่อถือได้จริง
 * (Postgres จะให้คำสั่งที่สองรอ row lock แล้วเช็คเงื่อนไขใหม่ ได้ count = 0)
 */
async function applyItemStatus(
  orderId: string,
  itemIds: string[],
  from: OrderItemStatus,
  transition: Partial<Record<OrderItemStatus, OrderItemStatus>>,
): Promise<number> {
  const to = transition[from];

  if (!to || !canTransitionOrderItem(from, to)) {
    return 0;
  }

  const now = new Date();
  const timestamp =
    to === "IN_PROGRESS"
      ? { startedAt: now }
      : to === "READY"
        ? { readyAt: now }
        : to === "SERVED"
          ? { servedAt: now }
          : {};

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.orderItem.updateMany({
      where: { id: { in: itemIds }, status: from },
      data: { status: to, ...timestamp },
    });

    if (count === 0) {
      return 0;
    }

    await syncOrderStatusFromItems(tx, orderId);

    return count;
  });
}

/** ประกาศให้ทุกจอที่เปิดค้างอยู่รู้ว่าสถานะรายการเปลี่ยน (เรียกหลัง commit เสมอ) */
async function publishItemStatusChanged(branchId: string, tableId: string | null) {
  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type: "order_item.status",
    branchId,
    tableId,
    at: Date.now(),
  });
}
