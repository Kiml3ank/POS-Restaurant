import "server-only";

import { prisma } from "@/lib/server/db";

/**
 * ตัวนับ "กรอก PIN ผิด" ที่เก็บใน Postgres (บทที่ 13b)
 *
 * ── ทำไมย้ายออกจาก memory ────────────────────────────────────────────────
 * เดิมตัวนับเป็น `Map` ใน process ซึ่งใช้ได้ตราบใดที่มี instance เดียว
 * พอ deploy หลาย instance (ซึ่งเป็นแผนตั้งแต่บทที่ 8 เรื่อง SSE) คนที่ไล่สุ่ม PIN
 * จะได้โควตาใหม่ทุกครั้งที่ load balancer สลับเครื่องให้ = เท่ากับไม่มี rate limit
 *
 * ── ทำไมเป็นไฟล์แยกจาก staff-session.ts ─────────────────────────────────
 * เพราะไฟล์นั้นเรียก `cookies()` ของ next/headers ซึ่งรันนอก request ของ Next ไม่ได้
 * ตรรกะการล็อกจึงทดสอบไม่ได้เลยถ้าอยู่ในไฟล์เดียวกัน — ที่นี่ไม่แตะ cookie เลย
 * จึงเรียกจาก `scripts/smoke-*.ts` ได้ตรง ๆ (ท่าเดียวกับ lib/server/receipt-issue.ts)
 *
 * ── สิ่งที่ตัวนับนี้ป้องกัน และไม่ป้องกัน ─────────────────────────────────
 * ป้องกัน: การไล่สุ่ม PIN ของ **รหัสพนักงานที่มีอยู่จริง** ซึ่งเป็นทางเข้าที่ทำอันตรายได้
 * ไม่ป้องกัน: การไล่สุ่มว่ามีรหัสพนักงานอะไรบ้าง — รหัสที่ไม่มีอยู่จริงไม่มีสาขาให้ผูก
 * แถวนับ และไม่ว่าจะเดาถูกหรือผิด ข้อความที่ได้กลับไปก็เหมือนกันเป๊ะ
 * (การกันเรื่องนั้นต้องเป็น rate limit ระดับ IP ที่ชั้น proxy ซึ่งเป็นคนละงาน)
 */

/** กรอกผิดครบจำนวนนี้ = ล็อกรหัสพนักงานนั้นไว้ชั่วคราว */
export const MAX_FAILED_ATTEMPTS = 5;

/** ล็อกนานเท่าไหร่หลังกรอกผิดครบ */
export const LOCKOUT_MINUTES = 5;

/**
 * ตัวนับที่ค้างอยู่นานกว่านี้ถือว่าเป็นคนละครั้ง แล้วเริ่มนับใหม่
 *
 * ต้องมี ไม่งั้นพนักงานที่กรอกผิดสองครั้งเมื่อเดือนที่แล้วจะเหลือโควตาแค่สามครั้ง
 * ไปตลอดกาล ซึ่งดูเหมือนระบบเสียมากกว่าดูเหมือนการป้องกัน
 */
const ATTEMPT_WINDOW_MINUTES = 30;

export type ThrottleState = { locked: false } | { locked: true; minutesLeft: number };

/** ตอนนี้รหัสนี้ถูกล็อกอยู่ไหม — เรียก **ก่อน** ตรวจ PIN เสมอ */
export async function checkLoginThrottle(
  branchId: string,
  staffCode: string,
): Promise<ThrottleState> {
  const row = await prisma.staffLoginThrottle.findUnique({
    where: { branchId_staffCode: { branchId, staffCode } },
  });

  if (!row?.lockedUntil || row.lockedUntil.getTime() <= Date.now()) {
    return { locked: false };
  }

  return {
    locked: true,
    minutesLeft: Math.max(1, Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000)),
  };
}

/**
 * บันทึกว่ากรอกผิดอีกหนึ่งครั้ง แล้วบอกกลับว่าตอนนี้ผิดไปกี่ครั้งแล้ว
 *
 * ใช้ `upsert` ครั้งเดียวไม่ได้ เพราะต้องอ่านค่าเดิมมาตัดสินว่า "หน้าต่างเวลาหมดแล้ว
 * ให้เริ่มนับใหม่" หรือ "นับต่อ" — เขียนเป็น transaction เพื่อไม่ให้สองคำขอที่เข้ามา
 * พร้อมกันอ่านค่าเดิมตัวเดียวกันแล้วเขียนทับกันจนนับได้แค่ครั้งเดียว
 */
export async function recordFailedLogin(branchId: string, staffCode: string): Promise<number> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const row = await tx.staffLoginThrottle.findUnique({
      where: { branchId_staffCode: { branchId, staffCode } },
    });

    const windowExpired =
      row !== null && now.getTime() - row.firstFailedAt.getTime() > ATTEMPT_WINDOW_MINUTES * 60_000;

    const failedCount = row === null || windowExpired ? 1 : row.failedCount + 1;
    const lockedUntil =
      failedCount >= MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
        : null;

    await tx.staffLoginThrottle.upsert({
      where: { branchId_staffCode: { branchId, staffCode } },
      create: { branchId, staffCode, failedCount, lockedUntil, firstFailedAt: now },
      update: {
        failedCount,
        lockedUntil,
        ...(windowExpired ? { firstFailedAt: now } : {}),
      },
    });

    return failedCount;
  });
}

/** ล็อกอินสำเร็จ = ล้างตัวนับทิ้ง (ลบแถวไปเลย ไม่ต้องเก็บแถวที่เป็นศูนย์ไว้) */
export async function clearLoginThrottle(branchId: string, staffCode: string) {
  await prisma.staffLoginThrottle.deleteMany({ where: { branchId, staffCode } });
}
