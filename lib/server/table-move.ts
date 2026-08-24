import "server-only";

import { canMoveTableSession } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * ย้ายโต๊ะ / รวมโต๊ะ (งานค้างจากบทที่ 9)
 *
 * ── ทำไมเป็นไฟล์แยก ─────────────────────────────────────────────────────
 * เป็น leaf module: ไม่มีไฟล์ไหนใน `lib/server/` import กลับมาที่นี่ (ท่าเดียวกับ
 * `receipt-issue.ts` ของบทที่ 12) — `pos.ts` อยู่ที่ 541 บรรทัดและทำหลายเรื่อง
 * อยู่แล้ว การยัดเพิ่มทำให้มันโตขึ้นอีกโดยไม่ได้ประโยชน์อะไรตอบแทน
 *
 * ── ทำไมเป็นสองฟังก์ชัน ไม่ใช่ตัวเดียวที่เดาเอง ──────────────────────────
 * ฟังก์ชันเดียวที่ดูว่า "ปลายทางว่างไหม" แล้วตัดสินใจเองว่าจะย้ายหรือรวม แปลว่า
 * คนที่ตั้งใจ **ย้าย** แล้วเผลอเลือกโต๊ะที่มีคนนั่ง จะได้ผลลัพธ์เป็นการรวมบิล
 * ของคนอื่นเข้าด้วยกัน — เป็นความเสียหายเรื่องเงินที่กู้คืนอัตโนมัติไม่ได้
 * (แยกกลับไม่ได้ เพราะหลังรวมแล้วของอาจถูกเสิร์ฟ/ยกเลิกไปแล้ว)
 *
 * ── สิ่งที่ทั้งสองฟังก์ชันไม่แตะเลย ─────────────────────────────────────
 * `buildBill()` · `takePayment()` · ใบเสร็จ · KDS — เพราะทั้งหมดอ่านจาก
 * `Order.tableSessionId` / `Order.tableId` ซึ่งที่นี่อัปเดตให้แล้วในทรานแซกชันเดียว
 * ตั๋วครัวจึงเปลี่ยนไปโชว์โต๊ะใหม่เอง โดยไม่มีใครต้องไปแก้ `getKitchenTickets()`
 */

/**
 * ออร์เดอร์ที่ต้องย้ายตามไปด้วย
 *
 * **รวม `DRAFT`** (ตะกร้าที่ยังไม่ได้กดส่ง) เพราะถ้าไม่ย้าย ของในตะกร้าจะค้างอยู่
 * กับรอบที่ถูกปิด/โต๊ะที่ว่างแล้ว แล้วหายไปจากสายตาทุกคน — บทเรียนเดียวกับกฎ
 * "ตะกร้า DRAFT ที่มีของ = จ่ายไม่ได้" ของบทที่ 11
 *
 * `CANCELLED` ไม่ย้าย: มันเป็นประวัติของโต๊ะเดิม ไม่ใช่ของที่ลูกค้าถือติดตัวไป
 */
const MOVABLE_ORDER_STATUSES = ["DRAFT", "PLACED", "IN_PROGRESS", "READY", "SERVED"] as const;

type MoveFailure = { ok: false; error: string };

type LoadedSession = Prisma.TableSessionGetPayload<{
  include: { table: true; payments: { select: { id: true } } };
}>;

/**
 * ด่าน "รอบนี้ขยับได้ไหม" ครบชุดในที่เดียว
 *
 * ทั้งย้ายและรวมเรียกตัวนี้ **ห้ามก๊อปเงื่อนไขไปเขียนซ้ำที่อื่น** — ที่ที่ลืมไป
 * ข้อหนึ่งคือประตูหลังที่เปิดค้าง (บทเรียนเดียวกับ `loadActiveStaffSession()`
 * ของบทที่ 13b) และที่นี่ประตูหลังแปลว่า "ขยับเงินของบิลที่ปิดไปแล้วได้"
 */
async function loadMovableSession(
  tx: Prisma.TransactionClient,
  branchId: string,
  sessionId: string,
  label: string,
): Promise<{ ok: true; session: LoadedSession } | MoveFailure> {
  const session = await tx.tableSession.findFirst({
    where: { id: sessionId, branchId, status: "OPEN" },
    include: { table: true, payments: { select: { id: true }, take: 1 } },
  });

  if (!session) {
    return { ok: false, error: `ไม่พบ${label}ที่เปิดอยู่` };
  }

  // รับเงินแล้ว = ประวัติ ห้ามขยับ (ปกติรอบที่จ่ายแล้วจะไม่ OPEN แต่ตรวจซ้ำไว้
  // เพราะราคาของการพลาดตรงนี้คือยอดขายย้อนหลังเปลี่ยนโดยไม่มีใครเห็น)
  if (session.payments.length > 0) {
    return { ok: false, error: `${label}นี้รับเงินไปแล้ว ขยับไม่ได้` };
  }

  /**
   * ติดธงส่วนลดพนักงานอยู่ = ปฏิเสธ
   *
   * ส่วนลดคิดจาก **ยอดรวมทั้งบิล** (ดู `buildBill()`) พอรวมสองโต๊ะเข้าด้วยกัน
   * ส่วนลด 10% ของคนที่ติดธงจะไปกินค่าอาหารของอีกโต๊ะด้วยทันที โดยที่หน้าจอ
   * ไม่ได้ถามอะไรเลย — บังคับให้ปลดธงก่อนแล้วติดใหม่หลังรวม เพื่อให้คนกดเห็น
   * ตัวเลขที่เปลี่ยนด้วยตาตัวเอง
   */
  if (session.staffCustomerId) {
    return {
      ok: false,
      error: `${label}ติดธงส่วนลดพนักงานอยู่ ให้ปลดธงก่อนแล้วค่อยทำรายการนี้`,
    };
  }

  /**
   * เฉพาะโต๊ะนั่งเท่านั้น
   *
   * ซื้อกลับไม่คิดเซอร์วิสชาร์จ (`billRatesForSalePoint`) ถ้าย้ายบิลข้ามช่องทางได้
   * ยอดที่ลูกค้าต้องจ่ายจะเปลี่ยนทันทีโดยไม่มีใครกดอะไรที่เกี่ยวกับเงินเลย
   */
  if (session.table.kind !== "DINE_IN") {
    return { ok: false, error: `${label}ไม่ใช่โต๊ะนั่ง ทำรายการนี้ไม่ได้` };
  }

  return { ok: true, session };
}

/** ย้ายออร์เดอร์ทั้งชุดไปอยู่กับรอบ/โต๊ะปลายทาง — คืนจำนวนใบและยอดที่ขยับ */
async function relocateOrders(
  tx: Prisma.TransactionClient,
  fromSessionId: string,
  to: { sessionId: string; tableId: string },
) {
  const orders = await tx.order.findMany({
    where: { tableSessionId: fromSessionId, status: { in: [...MOVABLE_ORDER_STATUSES] } },
    select: { id: true, subtotal: true, status: true },
  });

  if (orders.length > 0) {
    await tx.order.updateMany({
      where: { id: { in: orders.map((order) => order.id) } },
      data: { tableSessionId: to.sessionId, tableId: to.tableId },
    });
  }

  /**
   * แยกยอด "ที่อยู่ในบิลแล้ว" ออกจาก "ที่ยังอยู่ในตะกร้า"
   *
   * ยอดที่ขยับใช้ `subtotal` ของออร์เดอร์ **ไม่ใช่ `grandTotal`** เพราะคอลัมน์นั้น
   * ยังเป็น 0 จนกว่า `takePayment()` จะเติมตอนปิดบิล (บทที่ 11) — ใช้ค่าที่มีจริง
   * ณ ตอนนี้ ดีกว่าไปคิดยอดใหม่เองที่นี่ ซึ่งจะกลายเป็นที่ที่สองที่คิดเงิน
   * (การคิดยอดมีที่เดียวคือ `calculateBill()`)
   *
   * ที่ต้องแยกเพราะ **ตะกร้า `DRAFT` ไม่ได้อยู่ในยอดบิล** (`BILLABLE_ORDER_STATUSES`
   * ของ `billing.ts` เริ่มที่ `PLACED`) ถ้ารวมเป็นก้อนเดียว ตัวเลขใน AuditLog
   * จะไม่มีวันตรงกับยอดบิลที่คนสืบสวนเห็นบนหน้าจอ แล้วเขาจะสรุปว่าระบบคิดเงินเพี้ยน
   */
  const draftAmount = orders
    .filter((order) => order.status === "DRAFT")
    .reduce((sum, order) => sum + order.subtotal, 0);

  return {
    count: orders.length,
    /** ยอดที่อยู่ในบิลแล้ว — ตรงกับ `bill.subtotal` ที่หน้าจอแสดง */
    amount: orders.reduce((sum, order) => sum + order.subtotal, 0) - draftAmount,
    /** ยอดในตะกร้าที่ยังไม่ได้ส่งเข้าครัว — ขยับไปด้วยแต่ยังไม่ใช่เงินของบิล */
    draftAmount,
  };
}

export async function moveTableSession(
  staff: CurrentStaff,
  input: { sessionId: string; targetTableId: string },
) {
  // การซ่อนปุ่มบนหน้าจอไม่ใช่การกันสิทธิ์ — action ถูกยิงตรงด้วย POST ได้
  if (!canMoveTableSession(staff.role)) {
    return { ok: false as const, error: "ตำแหน่งของคุณย้ายโต๊ะไม่ได้" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // อ่านสดในทรานแซกชันเสมอ — ค่าที่หน้าจอส่งมาบอกได้แค่ "ผู้ใช้ตั้งใจอะไร"
    // ไม่ใช่ "ตอนนี้ยังจริงอยู่ไหม"
    const loaded = await loadMovableSession(tx, staff.branchId, input.sessionId, "รอบโต๊ะ");

    if (!loaded.ok) {
      return loaded;
    }

    const { session } = loaded;

    const target = await tx.restaurantTable.findFirst({
      where: { id: input.targetTableId, branchId: staff.branchId, isActive: true },
    });

    if (!target) {
      return { ok: false as const, error: "ไม่พบโต๊ะปลายทาง" };
    }

    if (target.kind !== "DINE_IN") {
      return { ok: false as const, error: "ย้ายไปจุดขายที่ไม่ใช่โต๊ะนั่งไม่ได้" };
    }

    if (target.id === session.tableId) {
      return { ok: false as const, error: "โต๊ะปลายทางเป็นโต๊ะเดิมอยู่แล้ว" };
    }

    const occupied = await tx.tableSession.count({
      where: { tableId: target.id, status: "OPEN" },
    });

    // ปฏิเสธแทนที่จะรวมให้เอง — คนกดต้องเป็นคนตัดสินใจว่าจะรวมเงินสองก้อน
    if (occupied > 0) {
      return {
        ok: false as const,
        error: `โต๊ะ ${target.name} มีบิลที่เปิดอยู่แล้ว ถ้าต้องการรวมบิลให้กด "รวมโต๊ะ"`,
      };
    }

    const moved = await relocateOrders(tx, session.id, {
      sessionId: session.id,
      tableId: target.id,
    });

    await tx.tableSession.update({
      where: { id: session.id },
      data: { tableId: target.id },
    });

    await tx.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: "AVAILABLE" },
    });
    await tx.restaurantTable.update({ where: { id: target.id }, data: { status: "OCCUPIED" } });

    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "table_session.move",
        entityType: "table_session",
        entityId: session.id,
        metadata: {
          fromTable: session.table.name,
          toTable: target.name,
          movedOrders: moved.count,
          // คำถามที่ต้องตอบย้อนหลังคือ "เงินก้อนไหนขยับ" ไม่ใช่แค่ "มีการย้ายเกิดขึ้น"
          movedAmount: moved.amount,
          movedDraftAmount: moved.draftAmount,
        },
      },
    });

    return {
      ok: true as const,
      movedOrders: moved.count,
      fromTableId: session.tableId,
      toTableId: target.id,
    };
  });

  if (result.ok) {
    // หลัง commit เท่านั้น (กฎบทที่ 8) และยิงสองโต๊ะ เพราะจอที่เปิดค้างอยู่มีทั้งสองฝั่ง
    await announce(staff.branchId, result.fromTableId);
    await announce(staff.branchId, result.toTableId);
  }

  return result;
}

async function announce(branchId: string, tableId: string) {
  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type: "table_session.changed",
    branchId,
    tableId,
    at: Date.now(),
  });
}
