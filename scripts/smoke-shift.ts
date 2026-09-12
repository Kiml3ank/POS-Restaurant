import "dotenv/config";

import { getSessionBill } from "@/lib/server/billing";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { openTableByStaff } from "@/lib/server/pos";
import {
  closeShift,
  getCashOutsideShift,
  getOpenShift,
  getShift,
  getShiftReport,
  openShift,
} from "@/lib/server/shift";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * Smoke test ของกะ / ปิดกะ (บทที่ 15)
 *
 *     npm run smoke:shift
 *
 * ── สิ่งที่ชุดนี้ต้องพิสูจน์ ──────────────────────────────────────────────
 *   1. **เงินสดที่ระบบว่าควรมี ตรงกับเงินที่เข้าลิ้นชักจริง** — ใช้ grandTotal
 *      ไม่ใช่ receivedAmount (เงินทอนออกไปแล้ว) และ QR ไม่นับ
 *   2. **ไม่มีเงินก้อนไหนหายระหว่างรอยต่อของกะ** — ปิดกะพร้อมกันสองเครื่อง
 *      หรือรับเงินคาบเกี่ยวกับการปิด ต้องไม่ทำให้บิลหลุดจากทั้งสองกะ
 *   3. **ตัวเลขในใบสรุปกะที่ปิดแล้วไม่ขยับตลอดกาล** แม้แก้อัตราภาษีทีหลัง
 *
 * ── ทำไมสร้างโต๊ะเอง ────────────────────────────────────────────────────
 * โต๊ะ seed ถูกชุดอื่นจองหมดแล้ว (A1 = smoke:order · A3 = smoke:payment ·
 * B1/B2 = smoke:pos) ชุดนี้จึงสร้างโต๊ะของตัวเองแล้วลบทิ้งตอนจบ
 *
 * ⚠ ยอดเงินทุกตัวในไฟล์นี้ **คิดจากราคาใน DB ผ่าน calculateBill() เสมอ**
 * ห้ามเขียนตัวเลขไว้เอง — สาขาเป็นสกุลไหน/อัตราเท่าไรเปลี่ยนได้ (กฎจากก้อน i18n)
 */

const TABLE_NAME = "SH-T1";

const KRAPAO = "seed-item-krapao";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

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
 * ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ → โต๊ะ แล้วค่อยลบกะ
 * (`Payment.shiftId` เป็น SetNull จึงลบกะทีหลังได้ แต่ต้องหลังลบ Payment เสมอ
 *  เพื่อไม่ให้เหลือแถวที่ชี้กะที่ไม่มีอยู่)
 */
async function cleanup(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, name: TABLE_NAME },
    select: { id: true },
  });
  const tableIds = tables.map((table) => table.id);

  if (tableIds.length > 0) {
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

  const shifts = await prisma.shift.findMany({ where: { branchId }, select: { id: true } });
  const shiftIds = shifts.map((shift) => shift.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: shiftIds } } });
  await prisma.shift.deleteMany({ where: { id: { in: shiftIds } } });
}

/** เปิดโต๊ะ ใส่ของ ส่งเข้าครัว แล้วรับเงิน — คืนยอดที่จ่ายจริง */
async function sellOneBill(
  staff: CurrentStaff,
  tableId: string,
  method: "CASH" | "QR",
  quantity: number,
) {
  const opened = await openTableByStaff(staff, tableId, 2);

  if (!opened.ok) {
    throw new Error(`เปิดโต๊ะไม่สำเร็จ: ${opened.errorKey}`);
  }

  const session = await prisma.tableSession.findFirstOrThrow({
    where: { tableId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  await addToCart({
    tableSessionId: session.id,
    branchId: staff.branchId,
    tableId,
    timezone: staff.branch.timezone,
    menuItemId: KRAPAO,
    quantity,
    modifierIds: KRAPAO_OPTIONS,
    note: null,
  });
  await placeOrder(session.id, { placedByStaffId: staff.id });

  const bill = await getSessionBill(staff.branchId, session.id);
  const total = bill!.bill.grandTotal;

  const paid = await takePayment(staff, tableId, {
    method,
    // จ่ายเกินแล้วรับทอน — เงินที่เข้าลิ้นชักจริงคือ grandTotal ไม่ใช่ยอดที่ยื่นมา
    receivedAmount: method === "CASH" ? total + 10000 : null,
    expectedTotal: total,
    sessionId: session.id,
  });

  if (!paid.ok) {
    throw new Error(`รับเงินไม่สำเร็จ: ${paid.errorKey}`);
  }

  return { paymentId: paid.paymentId, total };
}

async function main() {
  const cashier = await loadStaff("seed-staff-cashier");
  const branchId = cashier.branchId;

  await cleanup(branchId);

  const table = await prisma.restaurantTable.create({
    data: {
      branchId,
      name: TABLE_NAME,
      tableCode: `sh-t1-${Date.now()}`,
      seats: 4,
      kind: "DINE_IN",
      sortOrder: 910,
    },
  });

  /**
   * เงินสดนอกกะที่ "มีอยู่ก่อนแล้ว" ในฐาน dev — ชุดนี้วัด **ส่วนต่าง** ไม่ใช่ค่าสัมบูรณ์
   *
   * `getCashOutsideShift()` นับทุกแถวที่ `shiftId = null` ของสาขา ซึ่งถูกต้องตาม
   * ที่ spec เขียนไว้ แต่แปลว่าเลขจะเปลี่ยนตามของที่ค้างอยู่ในฐานของแต่ละเครื่อง
   * ถ้าเขียนเทียบค่าตรง ๆ เทสต์จะเขียวบนเครื่องที่ฐานสะอาดและแดงบนเครื่องที่มีข้อมูล
   */
  const outsideBefore = await getCashOutsideShift(branchId);

  console.log("── ผูกบิลเข้ากับกะ ─────────────────────────────────────────────\n");

  // ยังไม่มีกะเปิด → บิลต้องขายได้ตามปกติ และ shiftId ต้องเป็น null
  const outside = await sellOneBill(cashier, table.id, "CASH", 1);
  const outsideRow = await prisma.payment.findUniqueOrThrow({
    where: { id: outside.paymentId },
    select: { shiftId: true },
  });
  check("ไม่มีกะเปิดอยู่ก็ยังรับเงินได้ (ระบบกะไม่ใช่ด่านขวางการขาย)", outsideRow !== null);
  check("บิลที่รับนอกกะมี shiftId = null", outsideRow.shiftId === null);

  // เปิดกะด้วย prisma ตรง ๆ ใน Task นี้ (openShift() ยังไม่มี — เป็นงาน Task 2)
  const shift = await prisma.shift.create({
    data: { branchId, openedByStaffId: cashier.id, openingFloat: 100000 },
  });

  const inside = await sellOneBill(cashier, table.id, "CASH", 2);
  const insideRow = await prisma.payment.findUniqueOrThrow({
    where: { id: inside.paymentId },
    select: { shiftId: true },
  });
  check("บิลที่รับตอนมีกะเปิดอยู่ผูกกับกะนั้น", insideRow.shiftId === shift.id);

  // ปิดกะด้วย prisma ตรง ๆ แล้วขายต่อ — เงินต้องไม่ตกไปอยู่ในกะที่ปิดแล้ว
  await prisma.shift.update({
    where: { id: shift.id },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  const afterClose = await sellOneBill(cashier, table.id, "CASH", 1);
  const afterRow = await prisma.payment.findUniqueOrThrow({
    where: { id: afterClose.paymentId },
    select: { shiftId: true },
  });
  check("บิลที่รับหลังปิดกะไม่ตกไปอยู่ในกะที่ปิดแล้ว", afterRow.shiftId === null);

  console.log("\n── เปิดกะ ──────────────────────────────────────────────────────\n");

  const kitchen = await loadStaff("seed-staff-kitchen");
  const noRight = await openShift(kitchen, { openingFloat: 100000 });
  check("ครัวเปิดกะไม่ได้", noRight.ok === false, noRight.ok ? "" : noRight.errorKey);

  const badFloat = await openShift(cashier, { openingFloat: -1 });
  check("เงินทอนตั้งต้นติดลบ = error", badFloat.ok === false, badFloat.ok ? "" : badFloat.errorKey);

  const opened = await openShift(cashier, { openingFloat: 100000 });
  check("เปิดกะสำเร็จ", opened.ok === true, opened.ok ? "" : opened.errorKey);

  const current = await getOpenShift(branchId);
  check("getOpenShift() เจอกะที่เพิ่งเปิด", current?.id === (opened.ok ? opened.shiftId : ""));
  check("เก็บเงินทอนตั้งต้นไว้ถูก", current?.openingFloat === 100000, `${current?.openingFloat}`);
  check("บันทึกคนเปิดกะ", current?.openedByStaffId === cashier.id);

  const twice = await openShift(cashier, { openingFloat: 50000 });
  check("เปิดกะซ้อนขณะมีกะเปิดอยู่ = error", twice.ok === false, twice.ok ? "" : twice.errorKey);
  check(
    "เปิดซ้อนไม่สำเร็จแล้วต้องไม่มีกะที่สองค้างในฐาน",
    (await prisma.shift.count({ where: { branchId, status: "OPEN" } })) === 1,
  );

  const otherBranch = await prisma.branch.findFirst({ where: { id: { not: branchId } } });

  if (otherBranch) {
    check("กะของสาขาอื่นไม่โผล่มาที่สาขานี้", (await getOpenShift(otherBranch.id)) === null);
  }

  const openLog = await prisma.auditLog.findFirst({
    where: { action: "shift.open", entityId: opened.ok ? opened.shiftId : "" },
  });
  const openMeta = (openLog?.metadata ?? {}) as Record<string, unknown>;
  check("เขียน AuditLog ตอนเปิดกะ", openLog !== null);
  check("AuditLog เก็บเงินทอนตั้งต้น", openMeta.openingFloat === 100000);

  console.log("\n── X report ────────────────────────────────────────────────────\n");

  const shiftId = opened.ok ? opened.shiftId : "";

  const cash1 = await sellOneBill(cashier, table.id, "CASH", 2);
  const cash2 = await sellOneBill(cashier, table.id, "CASH", 1);
  const qr1 = await sellOneBill(cashier, table.id, "QR", 3);

  const report = await getShiftReport(branchId, shiftId);

  check("อ่าน X report ได้", report !== null);
  check(
    "ยอดขายรวมนับทุกช่องทางการจ่าย",
    report!.salesTotal === cash1.total + cash2.total + qr1.total,
    `${report!.salesTotal} vs ${cash1.total + cash2.total + qr1.total}`,
  );
  check("จำนวนบิลถูกต้อง", report!.billCount === 3, `${report!.billCount}`);
  check(
    "ยอดเงินสดนับเฉพาะบิลเงินสด (QR ไม่เข้าลิ้นชัก)",
    report!.cashTotal === cash1.total + cash2.total,
    `${report!.cashTotal} vs ${cash1.total + cash2.total}`,
  );
  check(
    "เงินสดที่ควรมี = เงินทอนตั้งต้น + ยอดขายเงินสด",
    report!.expectedCash === 100000 + cash1.total + cash2.total,
    `${report!.expectedCash}`,
  );
  check(
    "ใช้ grandTotal ไม่ใช่ receivedAmount (บิลจ่ายเกินแล้วทอนต้องไม่ทำให้ยอดพอง)",
    report!.expectedCash < 100000 + cash1.total + cash2.total + 10000,
  );
  check(
    "แยกตามวิธีจ่ายถูกต้อง",
    report!.byMethod.CASH.count === 2 && report!.byMethod.QR.count === 1,
    `CASH ${report!.byMethod.CASH.count} · QR ${report!.byMethod.QR.count}`,
  );
  check(
    "แยกตามช่องทางขายถูกต้อง (โต๊ะนั่งสามใบ)",
    report!.bySalePoint.DINE_IN.count === 3,
    `${report!.bySalePoint.DINE_IN.count}`,
  );

  // บิลใบแรกของไฟล์นี้ถูกรับตอนไม่มีกะ — ต้องไม่ถูกนับเข้ากะ แต่ต้องมองเห็นได้
  check("เงินที่รับนอกกะไม่ถูกนับเข้ากะ", report!.billCount === 3);

  const outsideCash = await getCashOutsideShift(branchId);
  check(
    "รายงานเงินสดนอกกะให้เห็นได้",
    outsideCash.count === outsideBefore.count + 2 &&
      outsideCash.total === outsideBefore.total + outside.total + afterClose.total,
    `${outsideCash.count} บิล ${outsideCash.total} (ก่อนหน้า ${outsideBefore.count}/${outsideBefore.total})`,
  );
  check("บอกช่วงเวลาของเงินนอกกะได้", outsideCash.firstAt !== null && outsideCash.lastAt !== null);

  check("X report ของกะที่ไม่มีอยู่คืน null", (await getShiftReport(branchId, "ไม่มีจริง")) === null);

  if (otherBranch) {
    check("X report ข้ามสาขาคืน null", (await getShiftReport(otherBranch.id, shiftId)) === null);
  }

  console.log("\n── ปิดกะ ───────────────────────────────────────────────────────\n");

  const expectedBefore = report!.expectedCash;

  const noRightClose = await closeShift(kitchen, { shiftId, countedCash: expectedBefore });
  check("ครัวปิดกะไม่ได้", noRightClose.ok === false, noRightClose.ok ? "" : noRightClose.errorKey);

  // ส่วนต่างไม่เป็นศูนย์แต่ไม่กรอกเหตุผล = ไม่ยอมปิด
  const noNote = await closeShift(cashier, { shiftId, countedCash: expectedBefore - 5000 });
  check(
    "ส่วนต่างไม่เป็นศูนย์แล้วไม่กรอกหมายเหตุ = error",
    noNote.ok === false,
    noNote.ok ? "" : noNote.errorKey,
  );
  check(
    "ปฏิเสธแล้วกะต้องยังเปิดอยู่",
    (await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).status === "OPEN",
  );

  const closed = await closeShift(cashier, {
    shiftId,
    countedCash: expectedBefore - 5000,
    note: "ทอนผิดตอนบ่าย",
  });
  check("ปิดกะสำเร็จ", closed.ok === true, closed.ok ? "" : closed.errorKey);

  const snapshot = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  check("สถานะเป็น CLOSED", snapshot.status === "CLOSED", snapshot.status);
  check("บันทึกเวลาและคนปิด", snapshot.closedAt !== null && snapshot.closedByStaffId === cashier.id);
  check("snapshot เงินที่ควรมี", snapshot.expectedCash === expectedBefore, `${snapshot.expectedCash}`);
  check("snapshot เงินที่นับได้", snapshot.countedCash === expectedBefore - 5000);
  check("ส่วนต่างเป็นลบเมื่อเงินขาด", snapshot.cashDifference === -5000, `${snapshot.cashDifference}`);
  check(
    "snapshot ยอดขายและจำนวนบิล",
    snapshot.salesTotal === report!.salesTotal && snapshot.billCount === 3,
  );
  check("เก็บหมายเหตุไว้", snapshot.note === "ทอนผิดตอนบ่าย");

  const breakdown = (snapshot.breakdown ?? {}) as {
    byMethod?: Record<string, { count: number; total: number }>;
  };
  check(
    "breakdown เก็บยอดแยกวิธีจ่าย",
    breakdown.byMethod?.CASH?.count === 2 && breakdown.byMethod?.QR?.count === 1,
  );

  const again = await closeShift(cashier, { shiftId, countedCash: 1, note: "กดซ้ำ" });
  check("ปิดกะที่ปิดไปแล้ว = คืนใบเดิม ไม่ใช่ error", again.ok === true && again.alreadyClosed);
  check(
    "กดซ้ำแล้วตัวเลขเดิมต้องไม่ถูกเขียนทับ",
    (await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).countedCash ===
      expectedBefore - 5000,
  );

  const closeLog = await prisma.auditLog.findFirst({
    where: { action: "shift.close", entityId: shiftId },
  });
  const closeMeta = (closeLog?.metadata ?? {}) as Record<string, unknown>;
  check("เขียน AuditLog ตอนปิดกะ", closeLog !== null);
  check(
    "AuditLog เก็บส่วนต่างเงินสด (ตัวเลขที่ต้องสืบย้อนได้)",
    closeMeta.expectedCash === expectedBefore &&
      closeMeta.countedCash === expectedBefore - 5000 &&
      closeMeta.cashDifference === -5000,
  );

  check("getShift() อ่านกะที่ปิดแล้วได้", (await getShift(branchId, shiftId))?.id === shiftId);
  check(
    "X report ไม่รับกะที่ปิดแล้ว (มีทางอ่านทางเดียว)",
    (await getShiftReport(branchId, shiftId)) === null,
  );

  // ── ตัวเลขที่ปิดไปแล้วต้องไม่ขยับ แม้แก้อัตราภาษีทีหลัง ──
  const branchBefore = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  await prisma.branch.update({ where: { id: branchId }, data: { vatRateBp: 1400 } });
  check(
    "แก้ VAT แล้วยอดในใบสรุปกะที่ปิดแล้วไม่ขยับ",
    (await getShift(branchId, shiftId))?.salesTotal === report!.salesTotal,
  );
  await prisma.branch.update({
    where: { id: branchId },
    data: { vatRateBp: branchBefore.vatRateBp },
  });

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup(branchId);
  check(
    "ล้างข้อมูลทดสอบหมดแล้ว",
    (await prisma.restaurantTable.count({ where: { branchId, name: TABLE_NAME } })) === 0 &&
      (await prisma.shift.count({ where: { branchId } })) === 0,
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
