import "server-only";

import { canMoveTableSession } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { BILLABLE_ORDER_STATUSES } from "@/lib/server/billing";
import { recalculateOrderSubtotal } from "@/lib/server/cart";
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

/**
 * ยุบตะกร้า `DRAFT` ของสองรอบให้เหลือใบเดียว — เรียกก่อน `relocateOrders()`
 *
 * **ทำไมต้องมี:** `getCart()` (และทุกหน้าจอที่เรียกมัน) เป็น `findFirst` บน
 * `status: "DRAFT"` ของรอบนั้น ถ้าปล่อยให้รอบเดียวมีตะกร้าสองใบ จะมีใบหนึ่ง
 * **ที่ไม่มีใครมองเห็นเลยทั้งจอพนักงานและมือถือลูกค้า** แต่ยังบล็อกการคิดเงินอยู่
 * (กฎบทที่ 11: "ตะกร้า DRAFT ที่มีของ = จ่ายไม่ได้") — แคชเชียร์จะเห็นตะกร้าว่าง
 * แล้วกดรับเงินไม่ผ่านโดยไม่มีทางรู้ว่าเพราะอะไร และของในใบที่มองไม่เห็นก็หายไปด้วย
 *
 * ลบใบที่ว่างแล้วทิ้งได้เพราะตะกร้าที่ยังไม่เคยกดส่งไม่ใช่ประวัติ — ไม่มีเงิน
 * ไม่มีใบเสร็จ และครัวไม่เคยเห็น (ต่างจาก `CANCELLED` ที่เป็นประวัติจริง)
 */
async function foldDraftCarts(
  tx: Prisma.TransactionClient,
  sourceSessionId: string,
  targetSessionId: string,
) {
  const sourceCart = await tx.order.findFirst({
    where: { tableSessionId: sourceSessionId, status: "DRAFT" },
    select: { id: true, subtotal: true },
  });

  const targetCart = await tx.order.findFirst({
    where: { tableSessionId: targetSessionId, status: "DRAFT" },
    select: { id: true },
  });

  // มีฝั่งเดียว = ไม่มีอะไรต้องยุบ ปล่อยให้ `relocateOrders()` ย้ายทั้งใบไปเลย
  if (!sourceCart || !targetCart) {
    return { folded: false as const, amount: 0 };
  }

  await tx.orderItem.updateMany({
    where: { orderId: sourceCart.id },
    data: { orderId: targetCart.id },
  });

  await recalculateOrderSubtotal(tx, targetCart.id);
  await tx.order.delete({ where: { id: sourceCart.id } });

  return { folded: true as const, amount: sourceCart.subtotal };
}

/**
 * ยอดค่าอาหารที่ "อยู่ในบิลแล้ว" ของรอบหนึ่ง — ตรงกับ `bill.subtotal` บนหน้าจอ
 *
 * ใช้รายชื่อสถานะชุดเดียวกับ `billing.ts` ไม่ได้เขียนใหม่ที่นี่ ไม่งั้นวันที่มี
 * สถานะใหม่เพิ่มเข้ามา ตัวเลขใน AuditLog จะเงียบ ๆ ไม่ตรงกับยอดที่คนสืบสวนเห็น
 */
async function billableAmountOf(tx: Prisma.TransactionClient, sessionId: string) {
  const total = await tx.order.aggregate({
    where: { tableSessionId: sessionId, status: { in: [...BILLABLE_ORDER_STATUSES] } },
    _sum: { subtotal: true },
  });

  return total._sum.subtotal ?? 0;
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

/**
 * รวมสองรอบขายเป็นบิลเดียว — รอบต้นทางถูก "กลืน" เข้าไปในรอบปลายทาง
 *
 * ── ทำไมกลืนรอบต้นทางทิ้ง ไม่ใช่ผูกสองรอบเข้าด้วยกัน ─────────────────────
 * ทั้งระบบตั้งอยู่บนกติกา **หนึ่งรอบขาย = หนึ่งบิล** (`getSessionBill()` ·
 * `takePayment()` · ใบเสร็จ ทุกตัวอ่านจาก `tableSessionId` ตัวเดียว) ถ้าเลือก
 * แบบ "สองรอบที่จ่ายพร้อมกัน" ต้องแก้ทั้งสามชั้นนั้นให้รับรายการรอบแทนรอบเดียว
 * ซึ่งเป็นการเปลี่ยนกติกาที่ทุกอย่างวางอยู่ เพื่อฟีเจอร์เดียว
 *
 * ราคาที่จ่ายแทน: **แยกกลับไม่ได้** — รอบต้นทางเหลือแค่ร่องรอย (`MERGED` +
 * `mergedIntoSessionId`) ไม่มีออร์เดอร์ของตัวเองแล้ว จึงเป็นเหตุผลที่การรวม
 * ต้องเป็นปุ่มแยกที่คนกดตั้งใจกด ไม่ใช่ผลข้างเคียงของการย้ายไปโต๊ะที่มีคนนั่ง
 */
export async function mergeTableSessions(
  staff: CurrentStaff,
  input: { sourceSessionId: string; targetSessionId: string },
) {
  if (!canMoveTableSession(staff.role)) {
    return { ok: false as const, error: "ตำแหน่งของคุณรวมโต๊ะไม่ได้" };
  }

  if (input.sourceSessionId === input.targetSessionId) {
    return { ok: false as const, error: "เลือกโต๊ะปลายทางที่ไม่ใช่บิลใบเดิม" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // ด่านชุดเดียวกันทั้งสองฝั่ง — ฝั่งที่ตรวจไม่ครบคือฝั่งที่เงินขยับได้โดยไม่มีใครเห็น
    const source = await loadMovableSession(tx, staff.branchId, input.sourceSessionId, "บิลต้นทาง");

    if (!source.ok) {
      return source;
    }

    const target = await loadMovableSession(
      tx,
      staff.branchId,
      input.targetSessionId,
      "บิลปลายทาง",
    );

    if (!target.ok) {
      return target;
    }

    // อ่านก่อนย้าย — หลังย้ายแล้วยอดสองก้อนนี้แยกจากกันไม่ได้อีก
    const targetAmountBefore = await billableAmountOf(tx, target.session.id);

    const folded = await foldDraftCarts(tx, source.session.id, target.session.id);

    const moved = await relocateOrders(tx, source.session.id, {
      sessionId: target.session.id,
      tableId: target.session.tableId,
    });

    /**
     * นับ "ออร์เดอร์ที่ออกไปจากรอบต้นทาง" ไม่ใช่ "แถวที่ถูก update"
     *
     * ตะกร้าที่ถูกยุบไม่ได้ย้ายทั้งใบ (ของในนั้นย้ายไปแล้วส่วนใบเปล่าถูกลบ) แต่ผลลัพธ์
     * ที่คนกดเห็นเหมือนกันคือรอบต้นทางไม่เหลืออะไรเลย — นับตกไปหนึ่งใบแปลว่า
     * ข้อความบนหน้าจอกับ AuditLog บอกจำนวนน้อยกว่าที่ขยับจริง
     */
    const movedOrders = moved.count + (folded.folded ? 1 : 0);

    await tx.tableSession.update({
      where: { id: source.session.id },
      data: {
        status: "MERGED",
        /**
         * โซ่ที่พามือถือลูกค้าไปบิลปลายทาง (Task 4) และทำให้ประวัติอ่านออกว่า
         * รอบนี้ไม่ได้หายไปเฉย ๆ — **ไม่ใช่หลักฐานหลักของการรวม** ตัวนั้นคือ
         * `AuditLog` ซึ่งเป็นตารางที่เขียนอย่างเดียวและไม่มีใครลบ (โซ่นี้เป็น
         * `onDelete: SetNull` จึงขาดได้เมื่อรอบปลายทางถูกล้างทิ้ง)
         */
        mergedIntoSessionId: target.session.id,
        closedAt: new Date(),
      },
    });

    /**
     * pax บวกกัน — บิลรวมคือคนสองกลุ่มที่นั่งด้วยกันแล้วจริง ๆ
     *
     * ไม่ใช่ตัวเลขประดับ: รายงาน "ยอดขายต่อหัว" ของบทที่ 15 ใช้ค่านี้เป็นตัวหาร
     * ถ้าปล่อยไว้เท่าเดิม โต๊ะที่ผ่านการรวมจะมียอดต่อหัวสูงเกินจริงทุกใบ
     */
    await tx.tableSession.update({
      where: { id: target.session.id },
      data: { pax: source.session.pax + target.session.pax },
    });

    await tx.restaurantTable.update({
      where: { id: source.session.tableId },
      data: { status: "AVAILABLE" },
    });
    await tx.restaurantTable.update({
      where: { id: target.session.tableId },
      data: { status: "OCCUPIED" },
    });

    await tx.auditLog.create({
      data: {
        branchId: staff.branchId,
        staffId: staff.id,
        action: "table_session.merge",
        entityType: "table_session",
        // ตัวที่หายไปจากหน้าจอคือรอบต้นทาง — คนสืบสวนจะเริ่มค้นจากตัวนั้น
        entityId: source.session.id,
        metadata: {
          fromTable: source.session.table.name,
          toTable: target.session.table.name,
          targetSessionId: target.session.id,
          movedOrders,
          movedAmount: moved.amount,
          // รวมของในตะกร้าที่ถูกยุบเข้าตะกร้าของปลายทางด้วย ไม่งั้นยอดนี้จะหายไปเฉย ๆ
          movedDraftAmount: moved.draftAmount + folded.amount,
          /** ใบที่ถูกยุบไม่ได้ถูกย้ายทั้งใบ แต่ของในนั้นย้ายครบ — บอกไว้ให้ตรวจสอบย้อนหลังตรงกัน */
          foldedDraftCart: folded.folded,
          /** มีทั้งสองก้อนถึงจะตอบได้ว่า "เงินก้อนไหนรวมกับก้อนไหน" ไม่ใช่แค่ "มีการรวม" */
          targetAmountBefore,
          pax: source.session.pax + target.session.pax,
        },
      },
    });

    return {
      ok: true as const,
      movedOrders,
      fromTableId: source.session.tableId,
      toTableId: target.session.tableId,
    };
  });

  if (result.ok) {
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
