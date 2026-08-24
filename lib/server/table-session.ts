import "server-only";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { TABLE_SESSION_COOKIE } from "@/lib/table-session-cookie";
import { branchDayKey } from "@/lib/branch-day";
import { joinsExistingSession, needsQueueNumber, showsInTableMap } from "@/lib/sale-point";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { Prisma } from "@/lib/generated/prisma/client";

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

  /**
   * หน้าจอลูกค้าใช้ได้เฉพาะโต๊ะนั่ง
   *
   * จุดขายที่ไม่ใช่โต๊ะมี `tableCode` ติดมาด้วยเพราะคอลัมน์บังคับ ไม่ใช่เพราะ
   * ตั้งใจให้สแกน — ถ้าปล่อยผ่าน ใครที่ถ่ายรูป QR ของเคาน์เตอร์ไปจะเปิดบิล
   * ซื้อกลับเองได้จากที่บ้าน แล้วครัวจะได้ออร์เดอร์ที่ไม่มีใครมารับ
   *
   * คืน null (= "ไม่มีจุดขายนี้") ตั้งใจไม่บอกว่า "มีอยู่แต่เข้าไม่ได้" เพราะ
   * การบอกแปลว่ายืนยันว่า code นี้มีจริง ซึ่งช่วยคนที่กำลังเดาโค้ดอยู่
   */
  if (!showsInTableMap(table.kind)) {
    return null;
  }

  const token = await readTableSessionToken();
  const session = token ? await resolveSessionByToken(table.branchId, token) : null;

  return {
    table,
    branch: table.branch,
    session,
    /**
     * ชื่อโต๊ะที่ลูกค้าสแกนมา เมื่อรอบขายไปอยู่โต๊ะอื่นแล้ว (ย้าย/รวมโต๊ะ)
     *
     * null = ยังอยู่โต๊ะเดิม · ไม่ใช่ null = หน้าจอ **ต้องบอกลูกค้าตรง ๆ** ว่า
     * ของที่สั่งต่อจากนี้เข้าบิลของโต๊ะไหน ห้ามเปลี่ยนชื่อโต๊ะบนจอเงียบ ๆ
     */
    mergedFromTableName: session && session.tableId !== table.id ? table.name : null,
  };
}

/** ลึกสุดที่ยอมเดินตามโซ่ — กันโซ่ที่วนกลับมาที่เดิม (A→B→A) ไม่ให้ค้างทั้ง request */
const MAX_MERGE_HOPS = 5;

/**
 * หารอบขายจาก token ของลูกค้า **แล้วเดินตามโซ่ merge ไปจนถึงรอบที่ยังเปิดอยู่**
 *
 * ── ทำไมเลิกผูก `tableId` ─────────────────────────────────────────────
 * เดิมเงื่อนไขมี `tableId` ติดอยู่ ซึ่งถูกต้องตอนที่รอบขายย้ายโต๊ะไม่ได้
 * พอย้าย/รวมโต๊ะได้แล้ว การผูก tableId แปลว่าลูกค้าที่ถือ cookie ใบเดิมจะได้
 * "ไม่มีรอบ" ทันทีที่พนักงานย้ายโต๊ะให้ แล้วถ้าเขากดเปิดโต๊ะใหม่จะเกิด
 * **บิลใบที่สองที่พนักงานไม่รู้ตัว** — ของที่สั่งไปจะไปโผล่คนละบิลกับที่คิดเงิน
 *
 * ราคาที่จ่ายแทน: cookie ใบหนึ่งใช้ได้กับหน้าโต๊ะไหนก็ได้ **ในสาขาเดียวกัน**
 * (ข้ามสาขาไม่ได้ — `branchId` ยังผูกอยู่) คนที่ถือ cookie ของโต๊ะตัวเองแล้วไป
 * เปิดหน้าของโต๊ะอื่น จะยังสั่งเข้าบิลของตัวเองเหมือนเดิม ไม่ใช่เข้าบิลคนอื่น
 * และหน้าจอจะขึ้นบอกว่าของเข้าบิลไหน (`mergedFromTableName`)
 *
 * แยกจาก `resolveCustomerContext()` เพราะตัวนั้นเรียก `cookies()` ของ next/headers
 * ซึ่งเรียกนอก request ของ Next ไม่ได้ — smoke test จึงเรียกตัวนี้ตรง ๆ แทน
 * (ท่าเดียวกับที่บทที่ 13b แยก `staff-session-store.ts` ออกมา)
 */
export async function resolveSessionByToken(branchId: string, token: string) {
  let current = await prisma.tableSession.findFirst({
    where: { token, branchId },
    include: SESSION_TABLE_INCLUDE,
  });

  for (let hop = 0; current && hop < MAX_MERGE_HOPS; hop += 1) {
    if (current.status === "OPEN") {
      // หมดอายุแล้วถือว่าไม่มีรอบ — ชั้นที่กัน "ถ่ายรูป QR ไปสั่งจากบ้านวันรุ่งขึ้น"
      return current.expiresAt > new Date() ? current : null;
    }

    // ปิดไปแล้วด้วยเหตุอื่น (จ่ายเงิน/ยกเลิก) = จบ ไม่ใช่พาไปบิลที่ปิดไปแล้ว
    if (current.status !== "MERGED" || !current.mergedIntoSessionId) {
      return null;
    }

    current = await prisma.tableSession.findUnique({
      where: { id: current.mergedIntoSessionId },
      include: SESSION_TABLE_INCLUDE,
    });
  }

  return null;
}

/** หน้าจอลูกค้าต้องบอกชื่อโต๊ะปลายทางได้เมื่อรอบถูกย้าย/รวม */
const SESSION_TABLE_INCLUDE = {
  table: { select: { id: true, name: true } },
} satisfies Prisma.TableSessionInclude;

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

  // ด่านเดียวกับใน resolveCustomerContext() — ต้องมีทั้งสองที่ เพราะ Server Action
  // ที่เรียกฟังก์ชันนี้ถูกยิงตรงด้วย POST ได้โดยไม่ผ่านหน้าจอที่ resolve มาก่อน
  if (!showsInTableMap(table.kind)) {
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
    /**
     * ต้องรู้ชนิดของจุดขายก่อนตัดสินใจอะไรทั้งสิ้น — โต๊ะนั่งเข้าร่วมบิลเดิม
     * ส่วนเคาน์เตอร์/ช่องไรเดอร์เปิดบิลใหม่ทุกครั้ง (ดู lib/sale-point.ts)
     * อ่านใน transaction เดียวกันเพื่อไม่ให้ค่าที่ใช้ตัดสินใจเก่ากว่าที่เขียนจริง
     */
    const salePoint = await tx.restaurantTable.findUniqueOrThrow({
      where: { id: input.tableId },
      select: { kind: true, branch: { select: { timezone: true } } },
    });

    if (joinsExistingSession(salePoint.kind)) {
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
    }

    const queue = needsQueueNumber(salePoint.kind)
      ? await nextQueueNumber(tx, input.branchId, salePoint.branch.timezone)
      : null;

    const created = await tx.tableSession.create({
      data: {
        branchId: input.branchId,
        tableId: input.tableId,
        token: randomBytes(32).toString("base64url"),
        pax: input.pax,
        openedByStaffId: input.openedByStaffId,
        expiresAt: new Date(now.getTime() + TABLE_SESSION_TTL_HOURS * 60 * 60 * 1000),
        queueDay: queue?.day ?? null,
        queueNumber: queue?.number ?? null,
      },
    });

    /**
     * `status` ของแถวจุดขายมีความหมายเฉพาะโต๊ะนั่ง
     *
     * เคาน์เตอร์มีบิลเปิดพร้อมกันได้หลายใบ ถ้าไปตั้ง OCCUPIED ให้ด้วย
     * จะไม่มีใครรู้ว่าเมื่อไหร่ควรตั้งกลับเป็น AVAILABLE (ปิดบิลใบไหนถึงจะว่าง?)
     * แล้วมันจะค้างเป็น "ไม่ว่าง" ตลอดกาล — ปล่อยไว้เฉย ๆ ถูกกว่า
     */
    if (showsInTableMap(salePoint.kind)) {
      await tx.restaurantTable.update({
        where: { id: input.tableId },
        data: { status: "OCCUPIED" },
      });
    }

    return created;
  });
}

/**
 * เลขคิวถัดไปของสาขาในวันนี้ — เริ่มที่ 1 ใหม่ทุกวัน
 *
 * ── ทำไมใช้ max+1 ได้ ทั้งที่บทที่ 12 บอกว่าห้าม ────────────────────────
 * เลขที่ใบกำกับภาษีห้ามใช้ `max+1` เพราะสองเครื่องที่กดพร้อมกันจะได้เลขเดียวกัน
 * แล้วเครื่องที่สองชน unique constraint → **การรับเงินล้มเหลวทั้งที่ลูกค้าจ่ายแล้ว**
 * ซึ่งรับไม่ได้ จึงต้องมี `DocumentCounter` ที่ล็อกแถว
 *
 * แต่เลขคิวคนละสถานการณ์: ถ้าชนกัน สิ่งที่ล้มเหลวคือ "การเปิดบิลใหม่" ซึ่งยัง
 * ไม่มีเงินเกี่ยวข้องเลย พนักงานกดใหม่อีกทีก็จบ และ `@@unique([branchId,
 * queueDay, queueNumber])` เป็นตัวกันไม่ให้ลูกค้าสองคนได้ "คิว 12" พร้อมกัน
 * — ซึ่งเป็นความเสียหายจริงข้อเดียวของเรื่องนี้ (เรียกแล้วมีคนมารับผิดคน)
 *
 * ราคาที่ยอมจ่าย: ไม่ต้องมีตารางตัวนับเพิ่ม และไม่ต้องให้การเปิดบิลของทั้งสาขา
 * เข้าคิวกันที่แถวเดียว ซึ่งเป็นต้นทุนที่เลขคิวไม่คุ้มจะจ่าย
 */
async function nextQueueNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  timezone: string,
): Promise<{ day: string; number: number }> {
  const day = branchDayKey(timezone);

  const last = await tx.tableSession.findFirst({
    where: { branchId, queueDay: day },
    orderBy: { queueNumber: "desc" },
    select: { queueNumber: true },
  });

  return { day, number: (last?.queueNumber ?? 0) + 1 };
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
