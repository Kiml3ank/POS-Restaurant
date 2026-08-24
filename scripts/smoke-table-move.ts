import "dotenv/config";

import { getSessionBill } from "@/lib/server/billing";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { openTableByStaff } from "@/lib/server/pos";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { moveTableSession } from "@/lib/server/table-move";

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
    where: { branchId, name: { in: [SRC_NAME, DST_NAME] } },
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

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup(branchId);
  check(
    "ล้างโต๊ะทดสอบหมดแล้ว",
    (await prisma.restaurantTable.count({
      where: { branchId, name: { in: [SRC_NAME, DST_NAME] } },
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
