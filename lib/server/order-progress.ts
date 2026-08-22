import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { OrderStatus } from "@/lib/generated/prisma/enums";
import { rollUpOrderStatus } from "@/lib/order-status";

/**
 * ปรับสถานะของ "บิล" ให้ตรงกับสถานะของ "รายการ" ในบิลนั้น (บทที่ 8)
 *
 * มีที่เดียวในระบบที่ทำเรื่องนี้ เพราะมีสามทางที่ทำให้สถานะรายการเปลี่ยน
 * แล้วบิลต้องขยับตาม:
 *   1. ครัวกดรับงาน/ทำเสร็จ            (lib/server/kds.ts)
 *   2. พนักงานกดเสิร์ฟแล้ว              (lib/server/kds.ts)
 *   3. ผู้จัดการยกเลิกรายการทิ้ง        (lib/server/pos.ts)
 * ถ้าปล่อยให้แต่ละที่คิดเอง สามที่นั้นจะค่อย ๆ เพี้ยนออกจากกัน แล้วผังโต๊ะกับ
 * หน้าติดตามออร์เดอร์ของลูกค้าจะบอกคนละเรื่องกันโดยไม่มีใครรู้
 *
 * **ต้องเรียกภายใน transaction เดียวกับที่แก้ OrderItem เสมอ** ไม่ใช่เรียกต่อท้าย
 * ไม่งั้นจะมีช่วงที่รายการทั้งบิลเป็น READY แล้วแต่หัวบิลยังเขียนว่า PLACED อยู่
 */

/**
 * ลำดับความคืบหน้าของบิล — ใช้ตัดสินว่าการขยับครั้งนี้ "เดินหน้า" หรือ "ถอยหลัง"
 *
 * ที่ต้องมีตัวนี้แยกจาก canTransitionOrder() ใน lib/order-status.ts เพราะ
 * ตารางนั้นตรวจการเดินทีละก้าว ซึ่งถูกสำหรับการกดปุ่มโดยคน แต่การ roll-up
 * ข้ามขั้นได้จริงและถูกต้อง เช่นบิลที่มีสองรายการ [PLACED, SERVED]
 * แล้วผู้จัดการยกเลิกรายการที่ยังไม่ได้ทำทิ้ง — บิลต้องกระโดดจาก PLACED
 * ไป SERVED ทันที เพราะไม่เหลืออะไรให้ครัวทำแล้ว
 *
 * PAID ไม่มีทางมาจากการ roll-up (การจ่ายเงินเป็นเรื่องของทั้งบิล — บทที่ 10)
 * แต่ต้องอยู่ในลำดับเพื่อให้เทียบได้ว่าบิลที่จ่ายแล้ว "ล้ำหน้ากว่า" ทุกค่าที่ roll-up คืนมา
 */
const ORDER_PROGRESS: readonly OrderStatus[] = [
  "DRAFT",
  "PLACED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
  "PAID",
];

/** timestamp ที่ต้องประทับเมื่อบิลเข้าสถานะนั้นเป็นครั้งแรก */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof Prisma.OrderUpdateInput>> = {
  IN_PROGRESS: "startedAt",
  READY: "readyAt",
  SERVED: "servedAt",
  CANCELLED: "cancelledAt",
};

/**
 * อ่านสถานะรายการทั้งบิลแล้วเขียนสถานะบิลใหม่ถ้าจำเป็น
 *
 * คืนสถานะล่าสุดของบิล (ค่าเดิมถ้าไม่ได้เปลี่ยน) เพื่อให้ผู้เรียกเอาไปตัดสินใจต่อได้
 * โดยไม่ต้อง query ซ้ำ
 */
export async function syncOrderStatusFromItems(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<OrderStatus | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, items: { select: { status: true } } },
  });

  if (!order) {
    return null;
  }

  // บิลที่จ่ายเงินแล้วต้องแข็งตัว ห้ามให้การแก้รายการย้อนหลังมาขยับสถานะได้อีก
  // (เคสโกงในบทที่ 13 คือ "บิลถูกยกเลิกหลังจ่ายเงินไม่กี่นาที" — ต้องปิดทางไว้ที่นี่ด้วย)
  if (order.status === "PAID") {
    return order.status;
  }

  const next = rollUpOrderStatus(order.items.map((item) => item.status));

  if (!next || next === order.status) {
    return order.status;
  }

  if (!isForwardTransition(order.status, next)) {
    return order.status;
  }

  const timestampField = STATUS_TIMESTAMP[next];

  await tx.order.update({
    where: { id: order.id },
    data: {
      status: next,
      // ประทับเวลาเฉพาะครั้งแรกที่เข้าสถานะนั้น — เวลาที่ใช้วัดว่าครัวทำนานแค่ไหน
      // (รายงานบทที่ 15) ต้องเป็นเวลาที่ "เริ่ม" จริง ไม่ใช่เวลาที่ถูกเขียนทับล่าสุด
      ...(timestampField ? { [timestampField]: new Date() } : {}),
    },
  });

  return next;
}

/**
 * true เมื่อการเปลี่ยนสถานะครั้งนี้เดินไปข้างหน้า (หรือเข้าสู่ CANCELLED)
 *
 * ตั้งใจ "ไม่ยอมถอยหลัง" ทุกกรณี — บิลที่เคยขึ้น READY แล้วกลับไป IN_PROGRESS
 * เองเงียบ ๆ คือสัญญาณว่ามีบั๊ก ปล่อยให้สถานะค้างไว้แล้วไปหาสาเหตุ
 * ดีกว่าเขียนทับจนหลักฐานหาย
 */
function isForwardTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === "CANCELLED") {
    return false;
  }

  if (to === "CANCELLED") {
    return true;
  }

  const fromRank = ORDER_PROGRESS.indexOf(from);
  const toRank = ORDER_PROGRESS.indexOf(to);

  return fromRank >= 0 && toRank > fromRank;
}
