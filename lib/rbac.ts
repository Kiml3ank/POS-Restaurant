import type { StaffRole } from "@/lib/generated/prisma/enums";

/**
 * สิทธิ์ตามตำแหน่ง (ฐานของบทที่ 13 — ดึงมาทำก่อนเท่าที่ POS บทที่ 9 ต้องใช้)
 *
 * เก็บเป็นตารางกลางไฟล์เดียว ไม่กระจายเงื่อนไข `role === "OWNER"` ไว้ทั่วโค้ด
 * เพราะเวลาร้านขอเพิ่มตำแหน่งใหม่ จะได้แก้ที่เดียวจบ
 *
 * ไม่มี `import "server-only"` เพราะหน้าจอต้องใช้ตัดสินว่าจะโชว์ปุ่มไหน —
 * แต่ **การซ่อนปุ่มไม่ใช่การกันสิทธิ์** ทุก Server Action ต้องเช็คซ้ำฝั่ง server เสมอ
 */

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: "เจ้าของร้าน",
  MANAGER: "ผู้จัดการ",
  CASHIER: "แคชเชียร์",
  SERVER: "พนักงานเสิร์ฟ",
  KITCHEN: "ครัว",
};

/** หน้าจอที่มีการจำกัดสิทธิ์ — เพิ่ม "kds" / "admin" ตอนทำบทที่ 8 และ 13 */
export type StaffScreen = "pos";

const SCREEN_ROLES: Record<StaffScreen, readonly StaffRole[]> = {
  // ครัวไม่ต้องเข้าหน้า POS เพราะไม่ได้รับเงินและไม่ได้เปิดโต๊ะ
  pos: ["OWNER", "MANAGER", "CASHIER", "SERVER"],
};

export function canAccessScreen(role: StaffRole, screen: StaffScreen): boolean {
  return SCREEN_ROLES[screen].includes(role);
}

/**
 * การยกเลิกรายการที่ครัวเริ่มทำแล้ว = ของถูกทิ้งจริง มีต้นทุนจริง
 * จึงจำกัดไว้ที่ระดับหัวหน้าขึ้นไป และต้องกรอกเหตุผลเสมอ (เคสโกงในบทที่ 13)
 */
export function canCancelOrderItem(role: StaffRole): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "CASHIER";
}
