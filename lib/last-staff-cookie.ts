/**
 * ชื่อคนล่าสุดที่ใช้ "เครื่องนี้" — โชว์บนหน้าล็อกจอ
 *
 * ── ทำไมเป็น cookie ไม่ใช่ query จาก DB ───────────────────────────────────
 * ทางที่ง่ายกว่าคือ query Staff ที่ lastLoginAt ล่าสุดของสาขาแล้วเอามาโชว์
 * แต่หน้าล็อกอินยังไม่รู้ว่าเครื่องนี้อยู่สาขาไหน (ยังไม่มีใครล็อกอิน) —
 * จะกลายเป็นการ query ข้ามทั้งระบบแล้วโชว์ชื่อพนักงานของสาขาอื่นให้คนแปลกหน้าดู
 *
 * cookie ตอบคำถามที่ถูกกว่าด้วย: ไม่ใช่ "ใครล็อกอินล่าสุดในร้าน" แต่คือ
 * "ใครใช้เครื่องนี้ก่อนหน้าฉัน" ซึ่งเป็นสิ่งที่คนกำลังจะรับกะต่อจริง ๆ อยากรู้
 *
 * ── ที่ยอมแลกไป ──────────────────────────────────────────────────────────
 * จอ POS อยู่ในที่ที่ลูกค้ามองเห็น การโชว์ชื่อคือการเปิดเผยข้อมูลออกไปหนึ่งชั้น
 * จึงเก็บ **เฉพาะชื่อกับตำแหน่ง ไม่เก็บรหัสพนักงาน** — รหัสคือครึ่งหนึ่งของ
 * สิ่งที่ต้องใช้ล็อกอิน ถ้าโชว์คู่กันจะเหลือแค่ต้องเดา PIN 4 หลักอย่างเดียว
 *
 * ค่านี้ไม่ได้เซ็นลายเซ็นเพราะ **ไม่มีอำนาจอะไรเลย** เป็นข้อความสำหรับแสดงผล
 * ล้วน ๆ ใครแก้ cookie ในเครื่องตัวเองก็ได้แค่หลอกตาตัวเอง — ห้ามเอาค่าจาก
 * ไฟล์นี้ไปใช้ตัดสินใจเรื่องสิทธิ์เด็ดขาด
 *
 * แยกไฟล์ด้วยเหตุผลเดียวกับ lib/staff-session-cookie.ts (proxy.ts ต้องใช้ค่าคงที่
 * นี้ได้โดยไม่ลาก server-only เข้าไป)
 */
import type { StaffScreen } from "@/lib/rbac";

/**
 * แยกใบต่อหน้าจอเหมือน session (ดูเหตุผลใน lib/staff-session-cookie.ts) —
 * "คนล่าสุดที่ใช้เครื่อง POS" กับ "คนล่าสุดที่ใช้จอครัว" เป็นคนละคำถาม
 */
export const lastStaffCookieName = (screen: StaffScreen) => `${screen}_last_staff`;

/** เก็บไว้ 30 วัน — เครื่องที่ไม่ถูกใช้นานขนาดนั้น ชื่อคนเก่าก็ไม่มีประโยชน์แล้ว */
export const LAST_STAFF_TTL_DAYS = 30;

export type LastStaffOnDevice = {
  /** ชื่อที่แสดง */
  name: string;
  /** ตำแหน่ง — เก็บเป็น string ดิบ ตอนแสดงผลตรวจด้วย isStaffRole() แล้วแปลผ่าน staffRoleKey() */
  role: string;
  /** epoch milliseconds ตอนที่ล็อกอินครั้งนั้น */
  at: number;
};

export function encodeLastStaff(value: LastStaffOnDevice): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeLastStaff(raw: string | undefined): LastStaffOnDevice | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString()) as LastStaffOnDevice;

    return typeof parsed?.name === "string" && typeof parsed?.at === "number" ? parsed : null;
  } catch {
    return null;
  }
}
