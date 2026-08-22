import "server-only";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { TABLE_SESSION_COOKIE } from "@/lib/table-session-cookie";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";

/**
 * โต๊ะ + รอบการใช้โต๊ะ (บทที่ 5) — ชั้นที่กันเคสในเล่ม
 * "ลูกค้าถ่ายรูป QR ที่โต๊ะไว้ แล้วกลับไปสั่งอาหารจากที่บ้านอีกสามวันถัดมา"
 *
 * tableCode อย่างเดียวกันไม่ได้เพราะมันไม่มีวันหมดอายุ ของจริงต้องมีสองชั้น:
 *   1. tableCode  — บอกว่า QR ใบนี้คือโต๊ะไหน (หมุนเปลี่ยนได้ตอนพิมพ์ QR ใหม่)
 *   2. TableSession — บอกว่า "รอบนี้" ยังเปิดอยู่ไหม มี expiresAt กำกับ
 *      token ของ session เก็บใน cookie httpOnly ฝั่งลูกค้า
 */

/** ชื่อ cookie มาจาก lib/table-session-cookie.ts เพราะ proxy.ts ต้องใช้ค่าเดียวกัน */
export { TABLE_SESSION_COOKIE };

/**
 * อายุของหนึ่งรอบโต๊ะ — ตั้งไว้ยาวพอสำหรับมื้อที่กินกันนาน แต่สั้นพอที่ QR
 * ที่ถูกถ่ายรูปติดมือไปจะใช้ไม่ได้ในวันรุ่งขึ้น
 *
 * ตั้งใจ "ไม่ต่ออายุอัตโนมัติ" ตอนลูกค้าสั่งเพิ่ม เพราะถ้าต่อไปเรื่อย ๆ
 * session ที่ลูกค้าลืมปิดจะไม่มีวันหมดอายุเลย — บทที่ 9 จะให้พนักงานเป็นคน
 * ปิด/เปิดรอบใหม่จากหน้า POS แทน
 */
export const TABLE_SESSION_TTL_HOURS = 3;

export type CustomerContext = Awaited<ReturnType<typeof resolveCustomerContext>>;

/** อ่าน token จาก cookie — คืน null เมื่อยังไม่เคยเปิดโต๊ะจากเครื่องนี้ */
export async function readTableSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(TABLE_SESSION_COOKIE)?.value ?? null;
}

/**
 * รวมทุกอย่างที่หน้าจอลูกค้าต้องรู้จาก URL /t/[tableCode] ไว้ในที่เดียว
 *
 * คืน session = null ได้ 3 กรณี และทุกกรณีจบที่หน้าจอ "เปิดโต๊ะ" เหมือนกัน:
 *   - ยังไม่มี cookie เลย (สแกน QR ครั้งแรก)
 *   - cookie ชี้ไป session ที่ปิดแล้ว/หมดอายุแล้ว
 *   - cookie ชี้ไป session ของ "โต๊ะอื่น" (ย้ายโต๊ะแล้วสแกน QR ใบใหม่)
 */
export async function resolveCustomerContext(tableCode: string) {
  const table = await prisma.restaurantTable.findUnique({
    where: { tableCode },
    include: { branch: true },
  });

  if (!table || !table.isActive || !table.branch.isActive) {
    return null;
  }

  const token = await readTableSessionToken();
  const session = token
    ? await prisma.tableSession.findFirst({
        where: {
          token,
          tableId: table.id,
          status: "OPEN",
          expiresAt: { gt: new Date() },
        },
      })
    : null;

  return { table, branch: table.branch, session };
}

/**
 * เปิดรอบโต๊ะ (หรือเข้าร่วมรอบที่เปิดค้างอยู่)
 *
 * ถ้าโต๊ะนี้มีรอบที่ยังเปิดอยู่แล้ว จะ "เข้าร่วมรอบเดิม" ไม่ใช่สร้างรอบใหม่
 * เพราะหนึ่งโต๊ะที่นั่งกันสี่คน สแกน QR สี่เครื่อง ต้องได้บิลใบเดียวกัน
 * ไม่ใช่แยกกันสี่บิล — ตะกร้าจึงผูกกับ TableSession ไม่ใช่ผูกกับเครื่อง
 *
 * ทั้งการสร้าง session และการเปลี่ยนสถานะโต๊ะเป็น OCCUPIED อยู่ใน
 * transaction เดียวกัน (CLAUDE.md หัวข้อ 4: แก้หลายตารางพร้อมกัน = ต้อง transaction)
 */
export async function openTableSession(tableCode: string, pax: number) {
  const table = await prisma.restaurantTable.findUnique({
    where: { tableCode },
    include: { branch: true },
  });

  if (!table || !table.isActive || !table.branch.isActive) {
    return null;
  }

  const session = await openOrJoinTableSession({
    tableId: table.id,
    branchId: table.branchId,
    pax,
  });

  await writeTableSessionCookie(session.token, session.expiresAt);

  // ผังโต๊ะของพนักงานต้องเห็นโต๊ะเปลี่ยนเป็น "เปิดอยู่" ทันทีที่ลูกค้าสแกน QR
  // โดยไม่ต้องกดโหลดใหม่ (บทที่ 8) — เรียกหลัง transaction ใน openOrJoinTableSession
  // commit ไปแล้วเท่านั้น
  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type: "table_session.changed",
    branchId: table.branchId,
    tableId: table.id,
    at: Date.now(),
  });

  return session;
}

/**
 * แกนกลางของการเปิด/เข้าร่วมรอบโต๊ะ ใช้ร่วมกันระหว่างลูกค้าที่สแกน QR (บทที่ 5)
 * กับพนักงานที่กดเปิดโต๊ะจากหน้า POS (บทที่ 9)
 *
 * ต่างกันแค่สองอย่าง: ฝั่งพนักงานบันทึก `openedByStaffId` ไว้ด้วย และไม่ต้องเขียน
 * cookie (เครื่อง POS ไม่ได้เป็นลูกค้าของโต๊ะนั้น) ตรรกะที่เหลือต้องเหมือนกันเป๊ะ
 * จึงต้องอยู่ฟังก์ชันเดียวกัน ไม่ใช่ก๊อปไปเขียนซ้ำสองที่แล้วค่อย ๆ เพี้ยนออกจากกัน
 */
export async function openOrJoinTableSession(input: {
  tableId: string;
  branchId: string;
  pax: number;
  openedByStaffId?: string;
}) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.tableSession.findFirst({
      where: { tableId: input.tableId, status: "OPEN", expiresAt: { gt: now } },
      orderBy: { openedAt: "desc" },
    });

    if (existing) {
      // เข้าร่วมรอบเดิม — อัปเดตจำนวนลูกค้าเฉพาะตอนที่กรอกมามากกว่าเดิม
      // (คนที่สองที่สแกนเข้ามาไม่ควรลดจำนวนที่คนแรกกรอกไว้)
      if (input.pax > existing.pax) {
        return tx.tableSession.update({ where: { id: existing.id }, data: { pax: input.pax } });
      }
      return existing;
    }

    const created = await tx.tableSession.create({
      data: {
        branchId: input.branchId,
        tableId: input.tableId,
        token: randomBytes(32).toString("base64url"),
        pax: input.pax,
        openedByStaffId: input.openedByStaffId,
        expiresAt: new Date(now.getTime() + TABLE_SESSION_TTL_HOURS * 60 * 60 * 1000),
      },
    });

    await tx.restaurantTable.update({
      where: { id: input.tableId },
      data: { status: "OCCUPIED" },
    });

    return created;
  });
}

/**
 * เขียน cookie ของ session — เรียกได้เฉพาะจาก Server Action / Route Handler เท่านั้น
 * (Next.js ตั้ง cookie ระหว่าง render ของ Server Component ไม่ได้ เพราะ header
 * ถูกส่งออกไปแล้วตอน stream เริ่ม)
 */
async function writeTableSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();

  store.set(TABLE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}
