import type { MessageKey } from "@/lib/i18n/vi";
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

/**
 * คีย์ป้ายสถานะบิล — ตัวข้อความอยู่ในพจนานุกรม ไม่ได้อยู่ที่นี่แล้ว
 *
 * ไฟล์นี้ยังเป็นเจ้าของกติกา "สถานะไหนใช้ป้ายไหน" เหมือนเดิม เปลี่ยนแค่ว่า
 * มันคืน **คีย์** แทน **คำ** — และเพราะชนิดที่คืนคือ MessageKey ตัว tsc
 * จะฟ้องเองถ้าเพิ่มสถานะใน schema แล้วลืมเพิ่มป้ายในพจนานุกรม
 */
export function orderStatusKey(status: OrderStatus): MessageKey {
  return `orderStatus.${status}`;
}

export function orderItemStatusKey(status: OrderItemStatus): MessageKey {
  return `orderItemStatus.${status}`;
}

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

/**
 * เส้นทางระดับ "รายการ" — KDS ทำงานที่ระดับนี้ (บทที่ 8)
 *
 * ต่างจากระดับบิลตรงที่ไม่มี PAID เพราะการจ่ายเงินเกิดกับทั้งบิล ไม่ใช่ทีละจาน
 * ส่วน SERVED เป็นปลายทางของรายการ (พนักงานเสิร์ฟกดจากหน้า POS ไม่ใช่ครัวกด)
 */
const ORDER_ITEM_STATUS_TRANSITIONS: Record<OrderItemStatus, readonly OrderItemStatus[]> = {
  DRAFT: ["PLACED", "CANCELLED"],
  PLACED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["READY", "CANCELLED"],
  READY: ["SERVED", "CANCELLED"],
  SERVED: [],
  CANCELLED: [],
};

export function canTransitionOrderItem(from: OrderItemStatus, to: OrderItemStatus): boolean {
  return ORDER_ITEM_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * ปุ่มที่ "ครัว" กดได้เท่านั้น — ครัวเดินได้แค่สองก้าวคือรับงานกับทำเสร็จ
 *
 * ตั้งใจไม่ให้ครัวกด SERVED เพราะครัวไม่ใช่คนยกไปวางบนโต๊ะ ถ้าให้ครัวกดได้
 * ตัวเลข "ของพร้อมเสิร์ฟค้างอยู่กี่จาน" บนผังโต๊ะจะกลายเป็นศูนย์ตลอดเวลา
 * แล้วพนักงานเสิร์ฟจะไม่มีทางรู้ว่ามีของรออยู่ที่ช่องรับอาหาร
 *
 * และตั้งใจไม่มีปุ่มถอยหลัง — ตาราง transition ด้านบนไม่ให้ย้อนอยู่แล้ว
 * ครัวที่กดพลาดต้องให้ผู้จัดการ "ยกเลิกรายการพร้อมเหตุผล" (บทที่ 9) แทน
 * เพื่อให้ทุกการแก้ย้อนหลังมีร่องรอยใน AuditLog เสมอ
 */
export const KITCHEN_NEXT_STATUS = {
  PLACED: "IN_PROGRESS",
  IN_PROGRESS: "READY",
} as const satisfies Partial<Record<OrderItemStatus, OrderItemStatus>>;

export type KitchenActionableStatus = keyof typeof KITCHEN_NEXT_STATUS;

/** true เมื่อรายการอยู่ในสถานะที่ครัวกดต่อได้ (ใช้แคบชนิดให้ TypeScript ด้วย) */
export function isKitchenActionable(
  status: OrderItemStatus,
): status is KitchenActionableStatus {
  return status in KITCHEN_NEXT_STATUS;
}

/** ป้ายบนปุ่มของจอครัว — อยู่ที่นี่เพื่อให้ทุกจอเรียกของเดียวกัน */
export function kitchenActionKey(status: KitchenActionableStatus): MessageKey {
  return `kitchenAction.${status}`;
}

/**
 * ความคืบหน้าของรายการเรียงจากน้อยไปมาก — ใช้หา "รายการที่ช้าที่สุดในบิล"
 * (CANCELLED ไม่อยู่ในลำดับนี้เพราะเป็นทางแยก ไม่ใช่ขั้นหนึ่งของความคืบหน้า)
 */
const ITEM_PROGRESS = ["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED"] as const;

/**
 * สถานะของบิล = สถานะของรายการที่ "ช้าที่สุด" ในบิลนั้น
 *
 * เล่มบอกไว้ว่าสถานะบิลคือผลรวมของรายการ คำถามคือรวมยังไง — เลือกเอา
 * ตัวที่ช้าที่สุด เพราะคำถามที่บิลต้องตอบให้ได้คือ "โต๊ะนี้รออะไรอยู่หรือเปล่า"
 * ไม่ใช่ "มีอะไรเสร็จแล้วบ้าง" บิลที่น้ำมาแล้วแต่ข้าวผัดยังไม่ออก = ยังไม่พร้อมเสิร์ฟ
 *
 * รายการที่ถูกยกเลิกไม่นับ และถ้าถูกยกเลิกหมดทั้งบิล บิลนั้นก็เป็น CANCELLED
 * (เคสนี้เกิดจริงเวลาผู้จัดการไล่ยกเลิกทีละรายการจนหมดใบ)
 *
 * คืน null เมื่อบิลไม่มีรายการเลย — ตะกร้าเปล่าที่เพิ่งเปิด ยังไม่ต้องแตะสถานะ
 */
export function rollUpOrderStatus(
  itemStatuses: readonly OrderItemStatus[],
): OrderStatus | null {
  if (itemStatuses.length === 0) {
    return null;
  }

  const active = itemStatuses.filter((status) => status !== "CANCELLED");

  if (active.length === 0) {
    return "CANCELLED";
  }

  const slowest = active.reduce((slowest, status) =>
    ITEM_PROGRESS.indexOf(status) < ITEM_PROGRESS.indexOf(slowest) ? status : slowest,
  );

  // ชื่อสถานะสองระดับตั้งให้ตรงกันตั้งแต่ใน schema จึงแปลงตรง ๆ ได้
  return slowest satisfies OrderStatus;
}

/** สถานะรายการที่ถือว่า "ยังอยู่ในมือครัว" — จอครัวดึงเฉพาะชุดนี้ (บทที่ 8) */
export const KITCHEN_ITEM_STATUSES = [
  "PLACED",
  "IN_PROGRESS",
  "READY",
] as const satisfies readonly OrderItemStatus[];

/** สถานะที่ถือว่า "ยังเปิดอยู่" — ใช้หาบิลค้างของโต๊ะในบทที่ 9-10 */
export const OPEN_ORDER_STATUSES = [
  "PLACED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
] as const satisfies readonly OrderStatus[];
