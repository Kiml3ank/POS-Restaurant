import "server-only";

import { calculateBill } from "@/lib/bill";
import { canSetStaffMeal } from "@/lib/rbac";
import { REALTIME_EVENT_VERSION } from "@/lib/realtime-events";
import { clientIp } from "@/lib/server/client-ip";
import { prisma } from "@/lib/server/db";
import { publishRealtimeEvent } from "@/lib/server/realtime";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * ส่วนลดพนักงาน — "บิลนี้พนักงานกิน" (บทที่ 13)
 *
 * ── สิ่งที่ไฟล์นี้กันไว้ ────────────────────────────────────────────────
 * ส่วนลดพนักงานเป็นช่องโกงคลาสสิก: ติดธงทุกบิลแล้วเก็บส่วนต่างเข้ากระเป๋า
 * การจำกัดสิทธิ์ให้เฉพาะผู้จัดการกดไม่ได้แก้ปัญหา (แค่ย้ายช่องไปที่ผู้จัดการ)
 * สิ่งที่กันได้จริงคือ **ทำให้ทุกครั้งที่กดมีชื่อคนกินติดอยู่และอ่านย้อนหลังได้**
 *
 * สามชั้นที่บังคับฝั่ง server ทั้งหมด:
 *   1. หนึ่งคนเป็น "ลูกค้า" ของรอบโต๊ะที่ยังเปิดอยู่ได้ **ทีละใบเท่านั้น**
 *   2. ต้องเป็นพนักงานที่ยัง active และอยู่สาขาเดียวกัน
 *   3. AuditLog ทุกการติด/ปลดธง พร้อม ใครกด · ใครกิน · ยอดบิล ณ ตอนนั้น · IP
 *
 * ── อัตราไม่ได้เก็บไว้ที่นี่ ─────────────────────────────────────────────
 * เก็บแค่ "ใครกิน" ส่วน **อัตราอ่านจาก `Branch.staffMealDiscountBp` สด**
 * ตอนแสดงบิล แล้ว snapshot ลง `Payment` ตอนปิดบิล — วงจรเดียวกับ VAT/เซอร์วิสชาร์จ
 *
 * ผลที่ตามมาและตั้งใจให้เป็น: **ลูกค้าสั่งเพิ่มแล้วส่วนลดขยับตามเอง**
 * ถ้าเก็บเป็นจำนวนเงินที่คิดไว้ตอนกด ส่วนลด 10% ของบิล ฿1,800 จะยังเป็น ฿180
 * ตอนบิลขึ้นเป็น ฿3,000 โดยไม่มีใครสังเกต
 */

export type StaffMealResult = { ok: true } | { ok: false; error: string };

/**
 * ติดธง "พนักงานกิน" ให้รอบโต๊ะที่เปิดอยู่ของโต๊ะนี้
 *
 * รับ `tableId` ไม่ใช่ `tableSessionId` เพราะหน้าจอรู้จักโต๊ะ ไม่ได้รู้จักรอบ —
 * แบบเดียวกับ `takePayment()` และด้วยเหตุผลเดียวกัน: รอบโต๊ะอาจถูกปิดไประหว่างที่
 * หน้าจอค้างอยู่ การหารอบสด ๆ ที่นี่จึงถูกกว่าการเชื่อ id ที่หน้าจอถือไว้
 */
export async function setStaffMeal(
  staff: CurrentStaff,
  tableId: string,
  staffCustomerId: string,
  sessionId?: string,
): Promise<StaffMealResult> {
  // การซ่อนปุ่มไม่ใช่การกันสิทธิ์ — action ถูกยิงตรงด้วย POST ได้
  if (!canSetStaffMeal(staff.role)) {
    return { ok: false, error: "ตำแหน่งของคุณติดธงส่วนลดพนักงานไม่ได้" };
  }

  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId: staff.branchId, isActive: true },
    select: { id: true },
  });

  if (!table) {
    return { ok: false, error: "ไม่พบโต๊ะนี้ในสาขาของคุณ" };
  }

  /**
   * คนกินต้องเป็นพนักงานที่ยัง active ในสาขาเดียวกัน
   *
   * `isActive` สำคัญกว่าที่เห็น: บัญชีที่ถูกปิดคือคนที่ลาออกไปแล้ว การยังใช้ชื่อ
   * คนนั้นรับส่วนลดได้ = ชื่อที่ตามตัวไม่ได้อยู่บนบิล ซึ่งเป็นสิ่งที่คนโกงต้องการพอดี
   */
  const customer = await prisma.staff.findFirst({
    where: { id: staffCustomerId, branchId: staff.branchId, isActive: true },
    select: { id: true, name: true, code: true },
  });

  if (!customer) {
    return { ok: false, error: "ไม่พบพนักงานคนนี้ หรือบัญชีถูกปิดใช้งานแล้ว" };
  }

  const ipAddress = await clientIp();

  const outcome = await prisma.$transaction(async (tx) => {
    const session = await tx.tableSession.findFirst({
      where: sessionId
        ? { id: sessionId, tableId: table.id, status: "OPEN" }
        : { tableId: table.id, status: "OPEN" },
      orderBy: { openedAt: "desc" },
      select: { id: true, staffCustomerId: true },
    });

    if (!session) {
      return { kind: "error" as const, error: "โต๊ะนี้ไม่มีรอบที่เปิดอยู่" };
    }

    /**
     * ── กฎ "หนึ่งคน หนึ่งบิลที่เปิดอยู่" ─────────────────────────────────
     * กันเคสที่ตรงไปตรงมาที่สุด: เอาชื่อพ่อครัวคนเดียวไปแปะห้าโต๊ะพร้อมกัน
     * แล้วทุกโต๊ะได้ส่วนลด — ซึ่งดูปกติมากถ้าดูทีละบิล
     *
     * เช็คในtransaction เดียวกับที่เขียน เพราะสองเครื่องกดพร้อมกันได้
     * (ยังมีช่องแคบ ๆ ที่สอง transaction ผ่านพร้อมกันได้เพราะไม่มี unique constraint
     * บังคับ — ใส่ไม่ได้เพราะเงื่อนไขคือ "เฉพาะแถวที่ status=OPEN" ซึ่ง Postgres
     * ต้องใช้ partial unique index ที่ Prisma ยังประกาศให้ไม่ได้ — ชั้นที่เหลือคือ
     * AuditLog ที่บันทึกทุกครั้ง ทำให้เคสนี้ตรวจเจอย้อนหลังได้แม้จะหลุดมา)
     */
    const otherOpen = await tx.tableSession.findFirst({
      where: {
        branchId: staff.branchId,
        status: "OPEN",
        staffCustomerId: customer.id,
        id: { not: session.id },
      },
      select: { table: { select: { name: true } } },
    });

    if (otherOpen) {
      return {
        kind: "error" as const,
        error: `${customer.name} มีบิลที่ยังไม่ปิดอยู่ที่โต๊ะ ${otherOpen.table.name} แล้ว — ปิดบิลนั้นก่อน`,
      };
    }

    const now = new Date();

    await tx.tableSession.update({
      where: { id: session.id },
      data: {
        staffCustomerId: customer.id,
        staffMealSetById: staff.id,
        staffMealSetAt: now,
      },
    });

    return {
      kind: "ok" as const,
      sessionId: session.id,
      previousCustomerId: session.staffCustomerId,
      customer,
      ipAddress,
    };
  });

  if (outcome.kind === "error") {
    return { ok: false, error: outcome.error };
  }

  await writeStaffMealLog(staff, {
    action: "table_session.staff_meal_set",
    sessionId: outcome.sessionId,
    tableId: table.id,
    staffCustomerId: outcome.customer.id,
    staffCustomerName: outcome.customer.name,
    previousCustomerId: outcome.previousCustomerId,
    ipAddress,
  });

  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type: "table_session.changed",
    branchId: staff.branchId,
    tableId: table.id,
    at: Date.now(),
  });

  return { ok: true };
}

/**
 * ปลดธง "พนักงานกิน" ออกจากรอบโต๊ะที่เปิดอยู่
 *
 * **ทุกคนที่ติดได้ ปลดได้** โดยไม่มีเงื่อนไขเพิ่ม — การปลดทำให้ลูกค้าจ่ายมากขึ้น
 * จึงไม่ใช่ทิศทางที่ต้องกัน (ต่างจากการติด) แต่ยังต้องลง AuditLog เพราะรูปแบบ
 * โกงที่ต้องจับคือ **"ติดธง → รับเงินตามยอดที่ลด → ปลดธง"** ซึ่งจะมองไม่เห็นเลย
 * ถ้าบันทึกเฉพาะตอนติด
 */
export async function clearStaffMeal(
  staff: CurrentStaff,
  tableId: string,
  sessionId?: string,
): Promise<StaffMealResult> {
  if (!canSetStaffMeal(staff.role)) {
    return { ok: false, error: "ตำแหน่งของคุณปลดธงส่วนลดพนักงานไม่ได้" };
  }

  const table = await prisma.restaurantTable.findFirst({
    where: { id: tableId, branchId: staff.branchId, isActive: true },
    select: { id: true },
  });

  if (!table) {
    return { ok: false, error: "ไม่พบโต๊ะนี้ในสาขาของคุณ" };
  }

  const ipAddress = await clientIp();

  const session = await prisma.tableSession.findFirst({
    where: sessionId
      ? { id: sessionId, tableId: table.id, status: "OPEN" }
      : { tableId: table.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true, staffCustomerId: true, staffCustomer: { select: { name: true } } },
  });

  if (!session) {
    return { ok: false, error: "โต๊ะนี้ไม่มีรอบที่เปิดอยู่" };
  }

  if (!session.staffCustomerId) {
    // ปลดของที่ไม่ได้ติดอยู่ = ไม่ใช่ error ผลลัพธ์ตรงกับที่ผู้ใช้ต้องการอยู่แล้ว
    return { ok: true };
  }

  await prisma.tableSession.update({
    where: { id: session.id },
    data: { staffCustomerId: null, staffMealSetById: null, staffMealSetAt: null },
  });

  await writeStaffMealLog(staff, {
    action: "table_session.staff_meal_clear",
    sessionId: session.id,
    tableId: table.id,
    staffCustomerId: session.staffCustomerId,
    staffCustomerName: session.staffCustomer?.name ?? null,
    previousCustomerId: session.staffCustomerId,
    ipAddress,
  });

  await publishRealtimeEvent({
    v: REALTIME_EVENT_VERSION,
    type: "table_session.changed",
    branchId: staff.branchId,
    tableId: table.id,
    at: Date.now(),
  });

  return { ok: true };
}

/**
 * เขียน AuditLog ของการติด/ปลดธง พร้อม **ยอดบิล ณ วินาทีนั้น**
 *
 * ยอดบิลสำคัญกว่าที่เห็น: log ที่บอกแค่ "ติดธงตอน 20:14" ตอบไม่ได้ว่าเสียหายเท่าไหร่
 * ส่วน log ที่บอกว่า "ติดธงตอนบิล ฿4,200 = ลด ฿420" ตอบได้ทันทีโดยไม่ต้องไปไล่หา
 * ออร์เดอร์ย้อนหลัง — และถ้าบิลถูกปลดธงทีหลัง ตัวเลขนี้คือหลักฐานเดียวที่เหลือ
 *
 * อยู่นอก transaction ของการอัปเดตโดยตั้งใจ: การคิดยอดบิลต้องอ่านออร์เดอร์ทั้งรอบ
 * ซึ่งไม่คุ้มที่จะถือ lock ไว้ระหว่างนั้น — และถ้า log พลาด สิ่งที่เสียคือรายละเอียด
 * ไม่ใช่ตัวธง (ต่างจาก payment.take ที่ต้องอยู่ใน transaction เดียวกัน)
 */
async function writeStaffMealLog(
  staff: CurrentStaff,
  input: {
    action: "table_session.staff_meal_set" | "table_session.staff_meal_clear";
    sessionId: string;
    tableId: string;
    staffCustomerId: string;
    staffCustomerName: string | null;
    previousCustomerId: string | null;
    ipAddress: string | null;
  },
): Promise<void> {
  const snapshot = await staffMealSnapshot(staff.branchId, input.sessionId);

  await prisma.auditLog.create({
    data: {
      branchId: staff.branchId,
      staffId: staff.id,
      action: input.action,
      entityType: "table_session",
      entityId: input.sessionId,
      ipAddress: input.ipAddress,
      metadata: {
        tableId: input.tableId,
        staffCustomerId: input.staffCustomerId,
        staffCustomerName: input.staffCustomerName,
        previousCustomerId: input.previousCustomerId,
        ...snapshot,
      },
    },
  });
}

/** ยอดบิลและส่วนลดที่คิดได้ ณ วินาทีที่กด — ใช้เป็นหลักฐานใน AuditLog */
async function staffMealSnapshot(branchId: string, sessionId: string) {
  const [branch, orders] = await Promise.all([
    prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: {
        currency: true,
        staffMealDiscountBp: true,
        serviceChargeBp: true,
        vatRateBp: true,
        pricesIncludeVat: true,
      },
    }),
    prisma.order.findMany({
      where: {
        tableSessionId: sessionId,
        status: { in: ["PLACED", "IN_PROGRESS", "READY", "SERVED"] },
      },
      select: { items: { where: { status: { not: "CANCELLED" } }, select: { lineTotal: true } } },
    }),
  ]);

  const subtotal = orders.reduce(
    (sum, order) => sum + order.items.reduce((s, item) => s + item.lineTotal, 0),
    0,
  );

  const bill = calculateBill({
    subtotal,
    discountAmount: staffMealDiscountAmount(subtotal, branch.staffMealDiscountBp),
    rates: {
      serviceChargeBp: branch.serviceChargeBp,
      vatRateBp: branch.vatRateBp,
      pricesIncludeVat: branch.pricesIncludeVat,
    },
  });

  return {
    currency: branch.currency,
    subtotal: bill.subtotal,
    discountBp: branch.staffMealDiscountBp,
    discountAmount: bill.discountAmount,
    grandTotal: bill.grandTotal,
  };
}

/**
 * จำนวนเงินส่วนลดพนักงานจากยอดค่าอาหาร — **ที่เดียวในระบบที่คิดตัวเลขนี้**
 *
 * คิดจาก `subtotal` (ค่าอาหารล้วน) ไม่ใช่จากยอดรวมท้ายบิล เพราะ `calculateBill()`
 * ใช้ `subtotal − discount` เป็นฐานของเซอร์วิสชาร์จอยู่แล้ว — ส่วนลดจึงลดทั้ง
 * ค่าอาหาร เซอร์วิสชาร์จ และ VAT ตามสัดส่วนโดยอัตโนมัติ ซึ่งเป็นสิ่งที่ถูกต้อง
 * (พนักงานไม่ควรจ่ายเซอร์วิสชาร์จเต็มบนของที่ได้ลดราคา)
 *
 * ปัดด้วย `Math.round` บนจำนวนเต็มล้วน ไม่มี float ที่ไหนเลย
 */
export function staffMealDiscountAmount(subtotal: number, discountBp: number): number {
  if (subtotal <= 0 || discountBp <= 0) {
    return 0;
  }

  // (subtotal × bp + 5000) / 10000 = ปัดครึ่งขึ้น ด้วยจำนวนเต็มล้วน (ท่าเดียวกับ applyRate ใน lib/bill.ts)
  const scaled = subtotal * discountBp + 5_000;
  return Math.min(subtotal, (scaled - (scaled % 10_000)) / 10_000);
}
