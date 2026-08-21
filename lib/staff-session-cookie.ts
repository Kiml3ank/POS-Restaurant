/**
 * ชื่อ cookie ของ session พนักงาน (บทที่ 9 + 13)
 *
 * แยกไฟล์ด้วยเหตุผลเดียวกับ lib/table-session-cookie.ts — `proxy.ts` ต้องใช้ค่านี้
 * แต่ห้าม import อะไรที่มี `server-only` หรือแตะ node:crypto เข้าไปใน proxy
 */
export const STAFF_SESSION_COOKIE = "pos_staff_session";
