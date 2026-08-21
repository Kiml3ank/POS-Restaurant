import type { OrderItemStatus, OrderStatus } from "@/lib/generated/prisma/enums";

/**
 * data contract กลางของสถานะออร์เดอร์ — ทั้ง 4 หน้าจออ้างไฟล์นี้ไฟล์เดียว
 * (CLAUDE.md หัวข้อ 1 + บทที่ 7)
 *
 * Prisma generate enum ออกมาเป็น string union ให้อยู่แล้ว ไฟล์นี้จึงไม่ประกาศ
 * ชนิดซ้ำ แต่เติมสองอย่างที่ schema เก็บไม่ได้:
 *   1. ป้ายภาษาไทยของแต่ละสถานะ (หน้าจอทุกจอต้องเรียกเหมือนกัน)
 *   2. ตารางการเปลี่ยนสถานะที่อนุญาต — กัน KDS/POS กระโดดข้ามขั้น
 *      เช่น PLACED → PAID ตรง ๆ โดยไม่ผ่านครัว
 *
 * ไม่มี `import "server-only"` เพราะ client component ใช้ป้ายพวกนี้ด้วย
 */

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "ตะกร้า",
  PLACED: "ส่งเข้าครัวแล้ว",
  IN_PROGRESS: "กำลังทำ",
  READY: "พร้อมเสิร์ฟ",
  SERVED: "เสิร์ฟแล้ว",
  PAID: "จ่ายแล้ว",
  CANCELLED: "ยกเลิก",
};

export const ORDER_ITEM_STATUS_LABEL: Record<OrderItemStatus, string> = {
  DRAFT: "ในตะกร้า",
  PLACED: "รอครัวรับ",
  IN_PROGRESS: "กำลังทำ",
  READY: "พร้อมเสิร์ฟ",
  SERVED: "เสิร์ฟแล้ว",
  CANCELLED: "ยกเลิก",
};

/**
 * เส้นทางที่เดินได้จากแต่ละสถานะ
 * DRAFT → PLACED → IN_PROGRESS → READY → SERVED → PAID (CANCELLED แตกออกได้ระหว่างทาง)
 *
 * ตั้งใจให้ SERVED → PAID เท่านั้นที่ปิดบิลได้ และเมื่อ PAID/CANCELLED แล้วจบ
 * ห้ามกลับ — บิลที่ "ยกเลิกหลังจ่ายเงิน" คือเคสโกงที่บทที่ 13 ต้องจับให้ได้
 */
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["PLACED", "CANCELLED"],
  PLACED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["READY", "CANCELLED"],
  READY: ["SERVED", "CANCELLED"],
  SERVED: ["PAID", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** สถานะที่ถือว่า "ยังเปิดอยู่" — ใช้หาบิลค้างของโต๊ะในบทที่ 9-10 */
export const OPEN_ORDER_STATUSES = [
  "PLACED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
] as const satisfies readonly OrderStatus[];
