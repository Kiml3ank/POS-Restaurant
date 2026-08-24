import "dotenv/config";

import { getSessionBill } from "@/lib/server/billing";
import { addToCart, getCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { openSalePointSession, openTableByStaff } from "@/lib/server/pos";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { resolveSessionByToken } from "@/lib/server/table-session";
import { mergeTableSessions, moveTableSession } from "@/lib/server/table-move";

/**
 * Smoke test ของการย้ายโต๊ะ / รวมโต๊ะ (งานค้างจากบทที่ 9)
 *
 *     npm run smoke:table-move
 *
 * ── สิ่งที่ชุดนี้ต้องพิสูจน์ ──────────────────────────────────────────────
 *   1. **ย้ายทั้งชุด ไม่ใช่แค่เปลี่ยนเลขโต๊ะ** — ออร์เดอร์ทุกใบรวมตะกร้า DRAFT
 *      ต้องตามไปด้วย และยอดบิลต้องเท่าเดิมเป๊ะ
 *   2. **ชั้นคิดเงิน/รับเงิน/ใบเสร็จไม่ต้องแก้เลย** — เคสท้ายไฟล์รับเงินบิลที่
 *      ผ่านการรวมมาแล้วจนออกใบเสร็จ ถ้าข้ออ้างนี้ผิดจะพังตรงนั้น
 *
 * ── ทำไมสร้างโต๊ะเอง ────────────────────────────────────────────────────
 * ฐาน seed มีโต๊ะนั่งแค่ 5 ตัวและถูกจองไว้หมดแล้ว (A1 = smoke:order ·
 * A3 = smoke:payment · B1/B2 = smoke:pos) ชุดนี้ต้องใช้พร้อมกันสองโต๊ะและต้อง
 * ควบคุมสถานะโต๊ะได้เต็มที่ จึงสร้างของตัวเองแล้วลบทิ้งตอนจบ
 */

const SRC_NAME = "MV-SRC";
const DST_NAME = "MV-DST";
/** เคาน์เตอร์ซื้อกลับของชุดนี้เอง — ใช้พิสูจน์ว่ารวมข้ามช่องทางไม่ได้ */
const CNT_NAME = "MV-CNT";

const KRAPAO = "seed-item-krapao";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];
const WATER = "seed-item-water";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
  }
}

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/**
 * ล้างของที่ชุดนี้สร้าง — ลำดับถูกบังคับด้วย FK แบบ Restrict ทั้งสาย:
 * ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ → โต๊ะ
 */
async function cleanup(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, name: { in: [SRC_NAME, DST_NAME, CNT_NAME] } },
    select: { id: true },
  });

  const tableIds = tables.map((table) => table.id);

  if (tableIds.length === 0) {
    return;
  }

  const sessions = await prisma.tableSession.findMany({
    where: { tableId: { in: tableIds } },
    select: { id: true },
  });

  const sessionIds = sessions.map((session) => session.id);

  await prisma.orderItemModifier.deleteMany({
    where: { orderItem: { order: { tableId: { in: tableIds } } } },
  });
  await prisma.orderItem.deleteMany({ where: { order: { tableId: { in: tableIds } } } });
  await prisma.order.deleteMany({ where: { tableId: { in: tableIds } } });
  await prisma.receipt.deleteMany({ where: { payment: { tableSessionId: { in: sessionIds } } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.deleteMany({ where: { id: { in: tableIds } } });
}

/** สร้างโต๊ะทดสอบสองตัวใหม่เอี่ยม */
async function createTables(branchId: string) {
  const stamp = Date.now();

  const src = await prisma.restaurantTable.create({
    data: {
      branchId,
      name: SRC_NAME,
      tableCode: `mv-src-${stamp}`,
      seats: 4,
      kind: "DINE_IN",
      sortOrder: 900,
    },
  });

  const dst = await prisma.restaurantTable.create({
    data: {
      branchId,
      name: DST_NAME,
      tableCode: `mv-dst-${stamp}`,
      seats: 4,
      kind: "DINE_IN",
      sortOrder: 901,
    },
  });

  return { src, dst };
}

/**
 * เปิดรอบโต๊ะแล้วใส่ของด้วย **ฟังก์ชันจริงของระบบ** ไม่ใช่ prisma.order.create()
 * ตรง ๆ — ไม่งั้นจะได้ข้อมูลที่ไม่เหมือนของจริงแล้วเทสต์จะเขียวทั้งที่เส้นทางจริงพัง
 *
 * ผลลัพธ์: หนึ่งออร์เดอร์ที่ส่งเข้าครัวแล้ว + หนึ่งตะกร้า DRAFT ที่ยังค้างอยู่
 */
async function openSessionWithOrders(
  staff: CurrentStaff,
  tableId: string,
  pax: number,
  timezone: string,
) {
  const opened = await openTableByStaff(staff, tableId, pax);

  if (!opened.ok) {
    throw new Error(`เปิดโต๊ะไม่สำเร็จ: ${opened.error}`);
  }

  const session = await prisma.tableSession.findFirstOrThrow({
    where: { tableId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  const cartLine = {
    tableSessionId: session.id,
    branchId: staff.branchId,
    tableId,
    timezone,
    note: null,
  };

  await addToCart({ ...cartLine, menuItemId: KRAPAO, quantity: 2, modifierIds: KRAPAO_OPTIONS });
  await placeOrder(session.id, { placedByStaffId: staff.id });

  // ตะกร้าใบที่สองที่ยังไม่ได้กดส่ง — ตัวนี้คือของที่หายได้ง่ายที่สุดตอนย้าย
  await addToCart({ ...cartLine, menuItemId: WATER, quantity: 1, modifierIds: [] });

  return session;
}

async function main() {
  const manager = await loadStaff("seed-staff-cashier");
  const branchId = manager.branchId;
  const timezone = manager.branch.timezone;

  await cleanup(branchId);

  console.log("── ย้ายโต๊ะ ─────────────────────────────────────────────────────\n");

  const { src, dst } = await createTables(branchId);
  const session = await openSessionWithOrders(manager, src.id, 2, timezone);

  const before = await getSessionBill(branchId, session.id);
  const ordersBefore = await prisma.order.count({ where: { tableSessionId: session.id } });

  check("ตั้งต้นมีสองออร์เดอร์ (ส่งครัวแล้วหนึ่ง + ตะกร้าหนึ่ง)", ordersBefore === 2, `${ordersBefore} ใบ`);

  const moved = await moveTableSession(manager, { sessionId: session.id, targetTableId: dst.id });

  check("ย้ายสำเร็จ", moved.ok === true, moved.ok ? "" : moved.error);
  check(
    "ย้ายออร์เดอร์ครบทุกใบ รวมตะกร้า DRAFT",
    moved.ok && moved.movedOrders === 2,
    moved.ok ? `${moved.movedOrders} ใบ` : "",
  );

  const after = await getSessionBill(branchId, session.id);

  check(
    "ยอดค่าอาหารเท่าเดิมเป๊ะหลังย้าย",
    before!.bill.subtotal === after!.bill.subtotal,
    `${before!.bill.subtotal} → ${after!.bill.subtotal}`,
  );
  check(
    "ยอดรวมทั้งสิ้นเท่าเดิมเป๊ะหลังย้าย",
    before!.bill.grandTotal === after!.bill.grandTotal,
    `${before!.bill.grandTotal} → ${after!.bill.grandTotal}`,
  );

  const stillOnOldTable = await prisma.order.count({
    where: { tableSessionId: session.id, tableId: src.id },
  });
  check("ไม่มีออร์เดอร์ที่ยังชี้โต๊ะเดิมค้างอยู่", stillOnOldTable === 0, `${stillOnOldTable} ใบ`);

  const draftMoved = await prisma.order.count({
    where: { tableSessionId: session.id, status: "DRAFT", tableId: dst.id },
  });
  check("ตะกร้า DRAFT ย้ายตามไปด้วย", draftMoved === 1, `${draftMoved} ใบ`);

  const movedSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
  check("รอบเดิมย้ายไปโต๊ะใหม่ ไม่ได้สร้างรอบใหม่", movedSession.tableId === dst.id);
  check("การย้ายไม่แตะโซ่ merge (ต้องเป็น null)", movedSession.mergedIntoSessionId === null);
  check("รอบยังเปิดอยู่หลังย้าย", movedSession.status === "OPEN", movedSession.status);

  const tablesAfter = await prisma.restaurantTable.findMany({
    where: { id: { in: [src.id, dst.id] } },
    select: { id: true, status: true },
  });
  check(
    "โต๊ะต้นทางกลับเป็นว่าง",
    tablesAfter.find((table) => table.id === src.id)?.status === "AVAILABLE",
  );
  check(
    "โต๊ะปลายทางเป็นไม่ว่าง",
    tablesAfter.find((table) => table.id === dst.id)?.status === "OCCUPIED",
  );

  const log = await prisma.auditLog.findFirst({
    where: { entityId: session.id, action: "table_session.move" },
    orderBy: { createdAt: "desc" },
  });
  const meta = (log?.metadata ?? {}) as Record<string, unknown>;

  check("เขียน AuditLog ตอนย้าย", log !== null);
  check("AuditLog เก็บชื่อโต๊ะต้นทาง-ปลายทาง", meta.fromTable === SRC_NAME && meta.toTable === DST_NAME);
  check(
    "AuditLog เก็บยอดเงินที่ถูกย้าย",
    meta.movedAmount === before!.bill.subtotal,
    `${String(meta.movedAmount)} vs ${before!.bill.subtotal}`,
  );

  // ── ด่านที่ต้องปฏิเสธ ────────────────────────────────────────────────
  console.log("\n── ด่านที่ต้องปฏิเสธ ────────────────────────────────────────────\n");

  const backToSame = await moveTableSession(manager, {
    sessionId: session.id,
    targetTableId: dst.id,
  });
  check("ย้ายไปโต๊ะเดิม = error", backToSame.ok === false, backToSame.ok ? "" : backToSame.error);

  const secondSession = await openSessionWithOrders(manager, src.id, 3, timezone);
  const intoOccupied = await moveTableSession(manager, {
    sessionId: secondSession.id,
    targetTableId: dst.id,
  });
  check(
    "ย้ายไปโต๊ะที่มีบิลเปิดอยู่ = error (ไม่ใช่กลายเป็นรวมเงียบ ๆ)",
    intoOccupied.ok === false,
    intoOccupied.ok ? "" : intoOccupied.error,
  );

  const kitchen = await loadStaff("seed-staff-kitchen");
  const noRight = await moveTableSession(kitchen, {
    sessionId: secondSession.id,
    targetTableId: dst.id,
  });
  check("ครัวย้ายโต๊ะไม่ได้", noRight.ok === false, noRight.ok ? "" : noRight.error);

  const counter = await prisma.restaurantTable.findFirst({
    where: { branchId, kind: { not: "DINE_IN" } },
  });

  if (counter) {
    const crossChannel = await moveTableSession(manager, {
      sessionId: secondSession.id,
      targetTableId: counter.id,
    });
    check(
      "ย้ายไปจุดขายที่ไม่ใช่โต๊ะนั่ง = error (ซื้อกลับไม่คิดเซอร์วิสชาร์จ ยอดจะเปลี่ยนเงียบ ๆ)",
      crossChannel.ok === false,
      crossChannel.ok ? "" : crossChannel.error,
    );
  }

  const otherBranch = await prisma.branch.findFirst({ where: { id: { not: branchId } } });

  if (otherBranch) {
    const foreignStaff: CurrentStaff = { ...manager, branchId: otherBranch.id };
    const crossBranch = await moveTableSession(foreignStaff, {
      sessionId: secondSession.id,
      targetTableId: dst.id,
    });
    check("ย้ายข้ามสาขา = error", crossBranch.ok === false, crossBranch.ok ? "" : crossBranch.error);
  }

  const flagged = await prisma.tableSession.update({
    where: { id: secondSession.id },
    data: { staffCustomerId: manager.id, staffMealSetById: manager.id, staffMealSetAt: new Date() },
  });
  const flaggedMove = await moveTableSession(manager, {
    sessionId: flagged.id,
    targetTableId: dst.id,
  });
  check(
    "รอบที่ติดธงส่วนลดพนักงาน = error (ส่วนลดจะไปกินอาหารของอีกโต๊ะ)",
    flaggedMove.ok === false,
    flaggedMove.ok ? "" : flaggedMove.error,
  );

  await prisma.tableSession.update({
    where: { id: secondSession.id },
    data: { staffCustomerId: null, staffMealSetById: null, staffMealSetAt: null },
  });

  console.log("\n── รวมสองโต๊ะเป็นบิลเดียว ───────────────────────────────────────\n");

  // สถานะตอนนี้: `session` อยู่ที่โต๊ะ DST · `secondSession` อยู่ที่โต๊ะ SRC — เปิดอยู่ทั้งคู่

  const mergeIntoItself = await mergeTableSessions(manager, {
    sourceSessionId: session.id,
    targetSessionId: session.id,
  });
  check(
    "รวมโต๊ะเข้ากับตัวเอง = error",
    mergeIntoItself.ok === false,
    mergeIntoItself.ok ? "" : mergeIntoItself.error,
  );

  const kitchenMerge = await mergeTableSessions(kitchen, {
    sourceSessionId: secondSession.id,
    targetSessionId: session.id,
  });
  check("ครัวรวมโต๊ะไม่ได้", kitchenMerge.ok === false, kitchenMerge.ok ? "" : kitchenMerge.error);

  if (otherBranch) {
    const foreignStaff: CurrentStaff = { ...manager, branchId: otherBranch.id };
    const crossBranchMerge = await mergeTableSessions(foreignStaff, {
      sourceSessionId: secondSession.id,
      targetSessionId: session.id,
    });
    check(
      "รวมข้ามสาขา = error",
      crossBranchMerge.ok === false,
      crossBranchMerge.ok ? "" : crossBranchMerge.error,
    );
  }

  /**
   * ธงส่วนลดพนักงานต้องถูกปฏิเสธ **ทั้งสองฝั่ง**
   *
   * ด่านชุดเดียวกันถูกเรียกสองครั้ง (ต้นทาง/ปลายทาง) — ถ้าวันหนึ่งมีคนก๊อป
   * เงื่อนไขไปเขียนซ้ำแล้วลืมฝั่งใดฝั่งหนึ่ง เคสคู่นี้คือตัวที่จับได้
   */
  await prisma.tableSession.update({
    where: { id: secondSession.id },
    data: { staffCustomerId: manager.id, staffMealSetById: manager.id, staffMealSetAt: new Date() },
  });

  const flaggedSource = await mergeTableSessions(manager, {
    sourceSessionId: secondSession.id,
    targetSessionId: session.id,
  });
  check(
    "ต้นทางติดธงส่วนลดพนักงาน = error",
    flaggedSource.ok === false,
    flaggedSource.ok ? "" : flaggedSource.error,
  );

  const flaggedTarget = await mergeTableSessions(manager, {
    sourceSessionId: session.id,
    targetSessionId: secondSession.id,
  });
  check(
    "ปลายทางติดธงส่วนลดพนักงาน = error (ส่วนลดจะไปกินค่าอาหารของอีกโต๊ะ)",
    flaggedTarget.ok === false,
    flaggedTarget.ok ? "" : flaggedTarget.error,
  );

  await prisma.tableSession.update({
    where: { id: secondSession.id },
    data: { staffCustomerId: null, staffMealSetById: null, staffMealSetAt: null },
  });

  // ── ข้ามช่องทาง ──────────────────────────────────────────────────────
  const counterTable = await prisma.restaurantTable.create({
    data: {
      branchId,
      name: CNT_NAME,
      tableCode: `mv-cnt-${Date.now()}`,
      seats: 0,
      kind: "COUNTER",
      sortOrder: 902,
    },
  });

  const openedCounter = await openSalePointSession(manager, counterTable.id);

  if (!openedCounter.ok) {
    throw new Error(`เปิดบิลเคาน์เตอร์ไม่สำเร็จ: ${openedCounter.error}`);
  }

  const crossChannelSource = await mergeTableSessions(manager, {
    sourceSessionId: openedCounter.session.id,
    targetSessionId: session.id,
  });
  check(
    "รวมบิลซื้อกลับเข้าโต๊ะนั่ง = error",
    crossChannelSource.ok === false,
    crossChannelSource.ok ? "" : crossChannelSource.error,
  );

  const crossChannelTarget = await mergeTableSessions(manager, {
    sourceSessionId: secondSession.id,
    targetSessionId: openedCounter.session.id,
  });
  check(
    "รวมโต๊ะนั่งเข้าบิลซื้อกลับ = error (ซื้อกลับไม่คิดเซอร์วิสชาร์จ ยอดจะเปลี่ยนเงียบ ๆ)",
    crossChannelTarget.ok === false,
    crossChannelTarget.ok ? "" : crossChannelTarget.error,
  );

  // ── รวมจริง ──────────────────────────────────────────────────────────
  const srcBill = await getSessionBill(branchId, secondSession.id);
  const dstBill = await getSessionBill(branchId, session.id);
  const srcBefore = await prisma.tableSession.findUniqueOrThrow({
    where: { id: secondSession.id },
  });
  const dstBefore = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
  const srcOrderCount = await prisma.order.count({ where: { tableSessionId: secondSession.id } });

  // ตะกร้าที่ยังไม่ได้กดส่งของทั้งสองฝั่ง — หลังรวมต้องเหลือใบเดียวและของครบ
  const srcDraftBefore = await prisma.order.findFirstOrThrow({
    where: { tableSessionId: secondSession.id, status: "DRAFT" },
    include: { items: { select: { id: true } } },
  });
  const dstDraftBefore = await prisma.order.findFirstOrThrow({
    where: { tableSessionId: session.id, status: "DRAFT" },
    include: { items: { select: { id: true } } },
  });

  const merged = await mergeTableSessions(manager, {
    sourceSessionId: secondSession.id,
    targetSessionId: session.id,
  });

  check("รวมสำเร็จ", merged.ok === true, merged.ok ? "" : merged.error);
  check(
    "ย้ายออร์เดอร์ครบทุกใบ รวมตะกร้า DRAFT",
    merged.ok && merged.movedOrders === srcOrderCount,
    merged.ok ? `${merged.movedOrders} / ${srcOrderCount} ใบ` : "",
  );

  const mergedBill = await getSessionBill(branchId, session.id);

  check(
    "ค่าอาหารของบิลรวม = ผลบวกของสองบิลเดิม",
    mergedBill!.bill.subtotal === srcBill!.bill.subtotal + dstBill!.bill.subtotal,
    `${srcBill!.bill.subtotal} + ${dstBill!.bill.subtotal} = ${mergedBill!.bill.subtotal}`,
  );
  check(
    "ยอดรวมประกอบกันลงตัวและเป็นจำนวนเต็ม",
    Number.isInteger(mergedBill!.bill.grandTotal) &&
      mergedBill!.bill.netAmount + mergedBill!.bill.vatAmount === mergedBill!.bill.grandTotal,
    `${mergedBill!.bill.netAmount} + ${mergedBill!.bill.vatAmount} = ${mergedBill!.bill.grandTotal}`,
  );

  /**
   * เซอร์วิสชาร์จ/VAT ต้องถูกคิด **ครั้งเดียวบนยอดรวม** (กฎบทที่ 10)
   *
   * ผลบวกของยอดสองใบที่คิดแยกกันมาแล้วต่างจากยอดที่คิดครั้งเดียวได้ไม่เกิน
   * หนึ่งหน่วยย่อยต่อใบ (ปัดครึ่งขึ้นใบละครั้ง) — ห่างกว่านั้นแปลว่ามีขั้นตอนไหน
   * คิดซ้ำหรือคิดตกไปหนึ่งชั้น
   */
  const naiveTotal = srcBill!.bill.grandTotal + dstBill!.bill.grandTotal;
  check(
    "ยอดรวมคิดครั้งเดียวบนยอดรวม ไม่ใช่ผลบวกที่ปัดเศษมาแล้วสองรอบ",
    Math.abs(mergedBill!.bill.grandTotal - naiveTotal) <= 2,
    `คิดครั้งเดียว ${mergedBill!.bill.grandTotal} vs ผลบวกสองใบ ${naiveTotal}`,
  );

  /**
   * ตะกร้าต้องเหลือใบเดียว
   *
   * `getCart()` เป็น `findFirst` บน DRAFT ของรอบนั้น — ถ้ารอบเดียวมีตะกร้าสองใบ
   * จะมีใบหนึ่งที่ไม่มีใครเห็นทั้งจอพนักงานและมือถือลูกค้า แต่ยังบล็อกการคิดเงินอยู่
   */
  const draftsAfter = await prisma.order.findMany({
    where: { tableSessionId: session.id, status: "DRAFT" },
  });
  check(
    "ตะกร้าเหลือใบเดียว (ไม่มีใบที่มองไม่เห็นบนหน้าจอค้างอยู่)",
    draftsAfter.length === 1,
    `${draftsAfter.length} ใบ`,
  );

  const visibleCart = await getCart(session.id);
  check(
    "ของในตะกร้าสองใบเดิมอยู่ครบในใบที่หน้าจอเห็น",
    visibleCart?.items.length === srcDraftBefore.items.length + dstDraftBefore.items.length,
    `${visibleCart?.items.length ?? 0} / ${srcDraftBefore.items.length + dstDraftBefore.items.length} บรรทัด`,
  );
  check(
    "ยอดในตะกร้าที่ยุบแล้วเท่ากับผลบวกของสองใบเดิม",
    (visibleCart?.subtotal ?? -1) === srcDraftBefore.subtotal + dstDraftBefore.subtotal,
    `${srcDraftBefore.subtotal} + ${dstDraftBefore.subtotal} = ${visibleCart?.subtotal ?? 0}`,
  );

  const srcAfter = await prisma.tableSession.findUniqueOrThrow({ where: { id: secondSession.id } });
  check("รอบต้นทางเป็น MERGED", srcAfter.status === "MERGED", srcAfter.status);
  check("รอบต้นทางชี้ไปรอบปลายทาง", srcAfter.mergedIntoSessionId === session.id);
  check("รอบต้นทางบันทึกเวลาปิดไว้", srcAfter.closedAt !== null);
  check(
    "รอบต้นทางไม่มีออร์เดอร์เหลือ",
    (await prisma.order.count({ where: { tableSessionId: secondSession.id } })) === 0,
  );

  const dstAfter = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
  check("รอบปลายทางยังเปิดอยู่", dstAfter.status === "OPEN", dstAfter.status);
  check(
    "pax บวกกัน (รายงานยอดต่อหัวบทที่ 15 ต้องได้ตัวหารที่ถูก)",
    dstAfter.pax === srcBefore.pax + dstBefore.pax,
    `${srcBefore.pax} + ${dstBefore.pax} = ${dstAfter.pax}`,
  );

  const tablesAfterMerge = await prisma.restaurantTable.findMany({
    where: { id: { in: [src.id, dst.id] } },
    select: { id: true, status: true },
  });
  check(
    "โต๊ะต้นทางกลับเป็นว่างหลังรวม",
    tablesAfterMerge.find((table) => table.id === src.id)?.status === "AVAILABLE",
  );
  check(
    "โต๊ะปลายทางยังไม่ว่าง",
    tablesAfterMerge.find((table) => table.id === dst.id)?.status === "OCCUPIED",
  );

  const mergeLog = await prisma.auditLog.findFirst({
    where: { entityId: secondSession.id, action: "table_session.merge" },
    orderBy: { createdAt: "desc" },
  });
  const mergeMeta = (mergeLog?.metadata ?? {}) as Record<string, unknown>;

  check("เขียน AuditLog ตอนรวมโต๊ะ", mergeLog !== null);
  check(
    "AuditLog เก็บชื่อโต๊ะต้นทาง-ปลายทาง",
    mergeMeta.fromTable === SRC_NAME && mergeMeta.toTable === DST_NAME,
  );
  check(
    "AuditLog เก็บยอดของบิลต้นทางที่ถูกกลืน",
    mergeMeta.movedAmount === srcBill!.bill.subtotal,
    `${String(mergeMeta.movedAmount)} vs ${srcBill!.bill.subtotal}`,
  );
  check(
    "AuditLog เก็บยอดบิลปลายทางก่อนรวม (ตอบได้ว่าเงินก้อนไหนรวมกับก้อนไหน)",
    mergeMeta.targetAmountBefore === dstBill!.bill.subtotal,
    `${String(mergeMeta.targetAmountBefore)} vs ${dstBill!.bill.subtotal}`,
  );
  check(
    "AuditLog นับยอดในตะกร้าที่ถูกยุบด้วย (ไม่หายไปเฉย ๆ)",
    mergeMeta.movedDraftAmount === srcDraftBefore.subtotal,
    `${String(mergeMeta.movedDraftAmount)} vs ${srcDraftBefore.subtotal}`,
  );

  /**
   * รับเงินบิลรวมจนจบ = ตัวพิสูจน์ข้ออ้างหลักของงานก้อนนี้
   *
   * ชั้นคิดเงิน/รับเงิน/ใบเสร็จไม่ถูกแก้เลยสักบรรทัด ถ้าข้ออ้างนั้นผิดจะพังตรงนี้
   */
  // ส่งตะกร้าที่ยุบแล้วเข้าครัวก่อน — กฎบทที่ 11: ตะกร้า DRAFT ที่มีของ = จ่ายไม่ได้
  const placedRest = await placeOrder(session.id, { placedByStaffId: manager.id });
  check(
    "ส่งตะกร้าที่ยุบแล้วเข้าครัวได้",
    placedRest.ok === true,
    placedRest.ok ? "" : placedRest.error,
  );

  const finalBill = await getSessionBill(branchId, session.id);
  check(
    "ยอดสุดท้ายรวมของจากตะกร้าที่ยุบแล้วครบ",
    finalBill!.bill.subtotal ===
      mergedBill!.bill.subtotal + srcDraftBefore.subtotal + dstDraftBefore.subtotal,
    `${mergedBill!.bill.subtotal} + ${srcDraftBefore.subtotal + dstDraftBefore.subtotal} = ${finalBill!.bill.subtotal}`,
  );

  const payment = await takePayment(manager, dst.id, {
    method: "CASH",
    receivedAmount: finalBill!.bill.grandTotal,
    expectedTotal: finalBill!.bill.grandTotal,
    sessionId: session.id,
  });

  check("รวมแล้วรับเงินได้จนจบ", payment.ok === true, payment.ok ? "" : payment.error);
  check(
    "ออกใบเสร็จให้บิลรวมแล้วหนึ่งใบ",
    (await prisma.receipt.count({
      where: { paymentId: payment.ok ? payment.paymentId : "" },
    })) === 1,
  );

  // ── รอบที่จบไปแล้วต้องขยับไม่ได้อีก ──────────────────────────────────
  const reopened = await openTableByStaff(manager, src.id, 2);

  if (!reopened.ok) {
    throw new Error(`เปิดโต๊ะใหม่ไม่สำเร็จ: ${reopened.error}`);
  }

  const paidMerge = await mergeTableSessions(manager, {
    sourceSessionId: session.id,
    targetSessionId: reopened.session.id,
  });
  check("รวมรอบที่จ่ายเงินแล้ว = error", paidMerge.ok === false, paidMerge.ok ? "" : paidMerge.error);

  const mergedAgain = await mergeTableSessions(manager, {
    sourceSessionId: secondSession.id,
    targetSessionId: reopened.session.id,
  });
  check(
    "รวมรอบที่ถูกกลืนไปแล้วซ้ำอีกรอบ = error",
    mergedAgain.ok === false,
    mergedAgain.ok ? "" : mergedAgain.error,
  );

  console.log("\n── มือถือลูกค้าเดินตามโซ่ ───────────────────────────────────────\n");

  /**
   * cookie ของลูกค้าเก็บ token ของรอบที่เขาเปิดไว้ ไม่ใช่เลขโต๊ะ — พอรอบถูกกลืน
   * ต้องพาไปโผล่ที่รอบปลายทาง ไม่ใช่กลายเป็น "ไม่มีรอบ" เพราะถ้าเป็นอย่างหลัง
   * ลูกค้าจะกดเปิดโต๊ะใหม่เอง = บิลใบที่สองที่พนักงานไม่รู้ตัว
   */
  const hopA = reopened.session;
  const openedB = await openTableByStaff(manager, dst.id, 2);

  if (!openedB.ok) {
    throw new Error(`เปิดโต๊ะปลายทางไม่สำเร็จ: ${openedB.error}`);
  }

  const hopB = openedB.session;
  const mergeAtoB = await mergeTableSessions(manager, {
    sourceSessionId: hopA.id,
    targetSessionId: hopB.id,
  });
  check("รวมรอบเปล่าสองรอบได้", mergeAtoB.ok === true, mergeAtoB.ok ? "" : mergeAtoB.error);

  const followedOneHop = await resolveSessionByToken(branchId, hopA.token);
  check(
    "cookie ของรอบที่ถูกกลืนเดินตามโซ่ไปรอบปลายทาง",
    followedOneHop?.id === hopB.id,
    `${followedOneHop?.id ?? "null"} vs ${hopB.id}`,
  );
  check(
    "หน้าจอลูกค้าได้ชื่อโต๊ะปลายทางไปแสดง",
    followedOneHop?.table.name === DST_NAME,
    followedOneHop?.table.name ?? "null",
  );

  const openedC = await openTableByStaff(manager, src.id, 1);

  if (!openedC.ok) {
    throw new Error(`เปิดโต๊ะชั้นที่สามไม่สำเร็จ: ${openedC.error}`);
  }

  const hopC = openedC.session;
  const mergeBtoC = await mergeTableSessions(manager, {
    sourceSessionId: hopB.id,
    targetSessionId: hopC.id,
  });
  check("รวมต่ออีกชั้นได้", mergeBtoC.ok === true, mergeBtoC.ok ? "" : mergeBtoC.error);

  const followedTwoHops = await resolveSessionByToken(branchId, hopA.token);
  check(
    "โซ่ลึกสองชั้นก็ยังเดินถึงปลายทาง",
    followedTwoHops?.id === hopC.id,
    `${followedTwoHops?.id ?? "null"} vs ${hopC.id}`,
  );

  check(
    "รอบที่ยังเปิดอยู่หาเจอตามปกติ",
    (await resolveSessionByToken(branchId, hopC.token))?.id === hopC.id,
  );

  // รอบที่จ่ายเงินไปแล้วต้องเป็น "ไม่มีรอบ" ไม่ใช่พาลูกค้าไปบิลที่ปิดไปแล้ว
  check("รอบที่จ่ายเงินแล้ว = ไม่มีรอบ", (await resolveSessionByToken(branchId, dstBefore.token)) === null);

  if (otherBranch) {
    check(
      "token ของสาขาอื่นหาไม่เจอ (โซ่ไม่ข้ามสาขา)",
      (await resolveSessionByToken(otherBranch.id, hopC.token)) === null,
    );
  }

  await prisma.tableSession.update({
    where: { id: hopC.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  check(
    "รอบที่หมดอายุแล้ว = ไม่มีรอบ (ชั้นกันถ่ายรูป QR ไปสั่งวันรุ่งขึ้น)",
    (await resolveSessionByToken(branchId, hopA.token)) === null,
  );

  /**
   * โซ่ที่วนกลับมาที่เดิม (ข้อมูลเพี้ยน) ต้องคืน null ไม่ใช่วนจนค้างทั้ง request
   * — เขียนสถานะเองตรง ๆ เพราะเส้นทางปกติสร้างโซ่แบบนี้ไม่ได้
   */
  await prisma.tableSession.update({
    where: { id: hopC.id },
    data: { status: "MERGED", mergedIntoSessionId: hopA.id },
  });
  check("โซ่ที่วนกลับมาที่เดิมคืน null ไม่ค้าง", (await resolveSessionByToken(branchId, hopA.token)) === null);

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup(branchId);
  check(
    "ล้างโต๊ะทดสอบหมดแล้ว",
    (await prisma.restaurantTable.count({
      where: { branchId, name: { in: [SRC_NAME, DST_NAME, CNT_NAME] } },
    })) === 0,
  );

  console.log(`\nรวม ${passed + failed} เคส — PASS ${passed} · FAIL ${failed}`);
}

main()
  .catch((error) => {
    console.error(error);
    failed += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
