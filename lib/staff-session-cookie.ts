import type { StaffScreenKind } from "@/lib/generated/prisma/enums";
import type { StaffScreen } from "@/lib/rbac";

/**
 * ชื่อ cookie ของ session พนักงาน — **แยกใบต่อหน้าจอ** (บทที่ 8/9 + 13)
 *
 * แยกไฟล์ด้วยเหตุผลเดียวกับ lib/table-session-cookie.ts — `proxy.ts` ต้องใช้ค่านี้
 * แต่ห้าม import อะไรที่มี `server-only` หรือแตะ node:crypto เข้าไปใน proxy
 *
 * ── ทำไมต้องแยกใบ ไม่ใช่ใบเดียวใช้ทั้งระบบ ───────────────────────────────
 * ตอนแรกใช้ cookie ใบเดียวชื่อ pos_staff_session ทั้ง /pos และ /kds
 * แล้วเจอบั๊กนี้ทันทีที่บทที่ 8 ทำให้หน้าจอ refresh เองได้:
 *
 *   1. เปิดแท็บ /pos ล็อกอินเป็นแคชเชียร์  → cookie = แคชเชียร์
 *   2. เปิดแท็บ /kds ล็อกอินเป็นครัว        → cookie ใบเดิม **ถูกเขียนทับ** = ครัว
 *   3. ครัวกด "ทำเสร็จ" → SSE → แท็บ POS สั่ง refresh
 *   4. แท็บ POS อ่าน cookie ได้ "ครัว" ซึ่งไม่มีสิทธิ์เข้า POS → เด้งไปหน้าใส่ PIN
 *
 * แล้วแคชเชียร์ก็ล็อกอินใหม่ ซึ่งไปเขียนทับ cookie ของครัวต่อ วนไปเรื่อย ๆ
 * ทั้งสองจอเตะกันเองทุกครั้งที่อีกฝั่งขยับ
 *
 * ที่หน้าร้านจริงสองจอนี้เป็นคนละเครื่อง จึงไม่เจอ — แต่ระหว่างพัฒนา (และเวลา
 * ผู้จัดการเปิดจอครัวดูบนแท็บเล็ตเครื่องเดียวกับที่ใช้คิดเงิน) มันคือเครื่องเดียวกัน
 * การให้แต่ละหน้าจอถือ session ของตัวเองจึงถูกกว่าทั้งสองกรณี ไม่ใช่แค่ทางแก้ dev
 *
 * ราคาที่จ่าย: ต้องใส่ PIN สองครั้งถ้าจะเปิดทั้งสองจอบนเครื่องเดียว — ซึ่งถูกแล้ว
 * เพราะสองจอนั้นอาจเป็นคนละคนกด และ AuditLog ต้องแยกออกจากกันให้ได้
 *
 * Record<StaffScreen, ...> ตั้งใจไม่ใส่ `?` — วันที่เพิ่มหน้าจอ "admin" เข้า
 * StaffScreen ในบทที่ 13 TypeScript จะบังคับให้มาเติม cookie ของมันที่นี่ด้วย
 */
export const STAFF_SESSION_COOKIES: Record<StaffScreen, string> = {
  pos: "pos_staff_session",
  kds: "kds_staff_session",
  /**
   * หลังร้าน (โมดูล 04) — กับดักที่วางไว้ตั้งแต่บทที่ 8 ทำงานจริง:
   * พอเติม "admin" เข้า StaffScreen แล้ว tsc พังทันทีที่บรรทัดนี้ว่ายังขาดคีย์
   * ไม่ต้องรอไปเจอตอนเปิดจอแล้วอ่าน cookie ผิดใบ
   */
  admin: "admin_staff_session",
};

/**
 * สะพานระหว่างชื่อจอฝั่ง TypeScript (ตัวเล็ก) กับ enum ในฐานข้อมูล (ตัวใหญ่)
 *
 * อยู่ไฟล์เดียวกับชื่อ cookie เพราะเป็นเรื่องเดียวกัน: "จอนี้เรียกว่าอะไรในแต่ละที่"
 * และเป็น Record เต็มด้วยเหตุผลเดียวกัน — เพิ่มจอที่สี่เมื่อไหร่ tsc จะพังตรงนี้
 * ให้เห็นทันที ไม่ใช่ไปเจอตอน insert แถวแล้วค่าไม่ตรง enum ของ Postgres
 *
 * ไม่ import ค่าจริงของ enum เข้ามา (ใช้ `import type`) เพื่อให้ไฟล์นี้ยัง
 * import จาก proxy.ts ได้เหมือนเดิม — proxy ห้ามลาก Prisma client เข้าไป
 */
export const STAFF_SCREEN_KIND: Record<StaffScreen, StaffScreenKind> = {
  pos: "POS",
  kds: "KDS",
  admin: "ADMIN",
};

/** ทุกใบรวมกัน — ใช้ตอนที่ยังไม่รู้ว่าคนเรียกมาจากจอไหน (เช่น /api/realtime) */
export const ALL_STAFF_SESSION_COOKIES = Object.values(STAFF_SESSION_COOKIES);
