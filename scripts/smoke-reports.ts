import "dotenv/config";

import { toCsv } from "@/lib/csv";
import { MAX_REPORT_DAYS, resolveReportRange } from "@/lib/report-range";
import { getSessionBill } from "@/lib/server/billing";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { openTableByStaff } from "@/lib/server/pos";
import { getSalesReport } from "@/lib/server/reports";
import type { CurrentStaff } from "@/lib/server/staff-session";

/**
 * Smoke test ของรายงานยอดขายย้อนหลัง + ส่งออก CSV
 *
 *     npm run smoke:reports
 *
 * ── สิ่งที่ชุดนี้ต้องพิสูจน์ ──────────────────────────────────────────────
 *   1. **ทุกส่วนของรายงานบวกกลับได้ตรงกัน** — แยกช่องทางจ่ายและแยกพนักงาน
 *      ต้องรวมได้เท่ายอดรวม ไม่งั้นทั้งหน้าเชื่อไม่ได้
 *   2. **ขอบช่วงถูกตามเวลาสาขา** ไม่ใช่ตาม UTC
 *   3. **CSV ที่ Excel เปิดแล้วอ่านภาษาเวียดนามออก** และ escape ถูก
 */

const TABLE_NAME = "RP-T1";
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
 * เที่ยงคืนของวันนั้นตามเวลาสาขา เป็น UTC
 *
 * เขียนซ้ำในเทสต์แทนที่จะ import `startOfBranchDayUtc()` โดยตั้งใจ —
 * ถ้าใช้ฟังก์ชันเดียวกับที่โค้ดจริงใช้ เทสต์ขอบช่วงจะผ่านเสมอแม้ฟังก์ชันนั้นผิด
 *
 * ⚠ รุ่นแรกของฟังก์ชันนี้เทียบแค่ **วันที่** (`en-CA` ของ 00:00Z กับ ymd) ซึ่งได้
 * drift = 0 ทุกครั้งที่วันตรงกัน แล้วคืน 00:00Z = 07:00 ตามเวลาเวียดนาม
 * ผลคือ "23:59:30 ของวันนี้" กลายเป็นเช้าวันถัดไป แล้วเทสต์ฟ้องว่าโค้ดจริงผิด
 * ทั้งที่ตัวเทสต์เองผิด — ต้องวัด offset จาก **เวลาเต็ม** ไม่ใช่แค่วัน
 */
function branchMidnightUtc(ymd: string, timezone: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const localAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );

  return new Date(guess.getTime() - (localAsUtc - guess.getTime()));
}

/** เวลาในโซนของสาขาแบบ `YYYY-MM-DD HH` — ใช้ยืนยันว่าเทสต์สร้างเวลาที่ตั้งใจจริง */
function branchStamp(at: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).format(at);

  return `${day} ${hour}`;
}

/** 23:59:30 ของวันนั้นตามเวลาสาขา คืนเป็น UTC */
function endOfBranchDay(ymd: string, timezone: string): Date {
  return new Date(branchMidnightUtc(ymd, timezone).getTime() + 24 * 60 * 60 * 1000 - 30_000);
}

/** เที่ยงคืนตรงของวันถัดไปตามเวลาสาขา */
function startOfNextBranchDay(ymd: string, timezone: string): Date {
  return new Date(branchMidnightUtc(ymd, timezone).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * ล้างของที่ชุดนี้สร้าง — ลำดับถูกบังคับด้วย FK แบบ Restrict ทั้งสาย:
 * ออร์เดอร์ → ใบเสร็จ → การรับเงิน → รอบโต๊ะ → โต๊ะ
 */
async function cleanup(branchId: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { branchId, name: TABLE_NAME },
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

/** ขายหนึ่งบิลแล้วคืนยอดที่จ่ายจริง — `paidAt` ถูกเลื่อนได้เพื่อทดสอบขอบช่วง */
async function sellOneBill(
  staff: CurrentStaff,
  tableId: string,
  method: "CASH" | "QR",
  quantity: number,
  paidAt?: Date,
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
    receivedAmount: method === "CASH" ? total : null,
    expectedTotal: total,
    sessionId: session.id,
  });

  if (!paid.ok) {
    throw new Error(`รับเงินไม่สำเร็จ: ${paid.errorKey}`);
  }

  if (paidAt) {
    // เลื่อนเวลาเพื่อทดสอบขอบช่วง — ทำได้เฉพาะในเทสต์ ไม่มีเส้นทางนี้ในแอป
    await prisma.payment.update({ where: { id: paid.paymentId }, data: { paidAt } });
  }

  return { paymentId: paid.paymentId, total };
}

async function main() {
  console.log("── ช่วงเวลา ────────────────────────────────────────────────────\n");

  const today = "2026-09-12";

  const preset = resolveReportRange({ preset: "last7", todayYmd: today });
  check(
    "preset 7 วันล่าสุดนับรวมวันนี้ (7 วัน ไม่ใช่ 8)",
    preset.ok && preset.range.fromDay === "2026-09-06" && preset.range.toDay === today,
    preset.ok ? `${preset.range.fromDay}..${preset.range.toDay}` : preset.errorKey,
  );

  const yesterday = resolveReportRange({ preset: "yesterday", todayYmd: today });
  check(
    "เมื่อวานเป็นวันเดียว ไม่ใช่ช่วงถึงวันนี้",
    yesterday.ok &&
      yesterday.range.fromDay === "2026-09-11" &&
      yesterday.range.toDay === "2026-09-11",
  );

  const month = resolveReportRange({ preset: "month", todayYmd: today });
  check(
    "เดือนนี้เริ่มวันที่ 1",
    month.ok && month.range.fromDay === "2026-09-01" && month.range.toDay === today,
  );

  const custom = resolveReportRange({ from: "2026-08-01", to: "2026-08-31", todayYmd: today });
  check("กรอกช่วงเองได้", custom.ok && custom.range.fromDay === "2026-08-01");

  const backwards = resolveReportRange({ from: "2026-08-31", to: "2026-08-01", todayYmd: today });
  check(
    "ช่วงที่กลับหัวกลับหาง = error ไม่ใช่สลับให้เงียบ ๆ",
    !backwards.ok && backwards.errorKey === "error.report_range_invalid",
  );

  const garbage = resolveReportRange({ from: "ไม่ใช่วันที่", to: today, todayYmd: today });
  check("รูปแบบวันที่ผิด = error", !garbage.ok);

  const tooLong = resolveReportRange({ from: "2026-01-01", to: "2026-12-31", todayYmd: today });
  check(
    "ช่วงเกิน 92 วัน = error ไม่ใช่ตัดเงียบ ๆ",
    !tooLong.ok && tooLong.errorKey === "error.report_range_too_long",
  );

  const exactLimit = resolveReportRange({ from: "2026-06-12", to: "2026-09-11", todayYmd: today });
  check(`ช่วง ${MAX_REPORT_DAYS} วันพอดียังผ่าน`, exactLimit.ok);

  const noParams = resolveReportRange({ todayYmd: today });
  check(
    "ไม่ระบุอะไรเลย = 7 วันล่าสุด (วันนี้อย่างเดียวมีหน้าสรุปวันนี้อยู่แล้ว)",
    noParams.ok && noParams.range.fromDay === "2026-09-06",
  );

  console.log("\n── CSV ─────────────────────────────────────────────────────────\n");

  const csv = toCsv([
    ["name", "qty", "amount"],
    ['Cơm "đặc biệt", loại lớn', 2, 84000],
    ["ไม่มีอะไรพิเศษ", 1, null],
  ]);

  check("ขึ้นต้นด้วย BOM (ไม่งั้น Excel อ่านภาษาเวียดนามเป็นขยะ)", csv.startsWith("﻿"));
  check(
    "ช่องที่มีคอมมาถูกครอบด้วยเครื่องหมายคำพูด",
    csv.includes('"Cơm ""đặc biệt"", loại lớn"'),
    csv.split("\r\n")[1],
  );
  check("เครื่องหมายคำพูดถูกหนีเป็นสองตัว", csv.includes('""đặc biệt""'));
  check("ขึ้นบรรทัดใหม่ด้วย CRLF ตามมาตรฐาน CSV", csv.includes("\r\n"));
  check("ตัวเลขไม่ถูกครอบด้วยเครื่องหมายคำพูด", csv.includes(",2,84000"));
  check("ค่า null เป็นช่องว่าง ไม่ใช่คำว่า null", csv.trimEnd().endsWith(",1,"));

  console.log("\n── ยอดขายในช่วง ────────────────────────────────────────────────\n");

  const cashier = await loadStaff("seed-staff-cashier");
  const owner = await loadStaff("seed-staff-owner");
  const branchId = cashier.branchId;
  const timezone = cashier.branch.timezone;

  await cleanup(branchId);

  const table = await prisma.restaurantTable.create({
    data: {
      branchId,
      name: TABLE_NAME,
      tableCode: `rp-t1-${Date.now()}`,
      seats: 4,
      kind: "DINE_IN",
      sortOrder: 920,
    },
  });

  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const range = { fromDay: todayYmd, toDay: todayYmd };

  const beforeReport = await getSalesReport(branchId, range, timezone);

  const a = await sellOneBill(cashier, table.id, "CASH", 2);
  const b = await sellOneBill(cashier, table.id, "QR", 1);
  const c = await sellOneBill(owner, table.id, "CASH", 3);

  const sold = a.total + b.total + c.total;
  const report = await getSalesReport(branchId, range, timezone);

  check(
    "รายได้เพิ่มขึ้นเท่ายอดบิลที่เพิ่งขาย",
    report.revenue === beforeReport.revenue + sold,
    `${report.revenue} vs ${beforeReport.revenue + sold}`,
  );
  check("จำนวนบิลเพิ่มขึ้นสามใบ", report.billCount === beforeReport.billCount + 3);
  check(
    "บิลเฉลี่ยเป็นจำนวนเต็มและหารลง",
    Number.isInteger(report.averageBill) &&
      report.averageBill === Math.floor(report.revenue / report.billCount),
    `${report.averageBill}`,
  );
  check(
    "แยกช่องทางจ่ายบวกกลับได้เท่ายอดรวม",
    report.byMethod.reduce((sum, row) => sum + row.total, 0) === report.revenue,
  );
  check(
    "มีบรรทัดของทุกช่องทางแม้ยอดเป็นศูนย์ (คนอ่านต้องเห็นว่าไม่มี ไม่ใช่หาไม่เจอ)",
    report.byMethod.length === 3 && report.byMethod.some((row) => row.method === "CARD"),
  );
  check(
    "แยกพนักงานบวกกลับได้เท่ายอดรวม",
    report.byStaff.reduce((sum, row) => sum + row.total, 0) === report.revenue,
  );
  check(
    "แยกพนักงานนับคนรับเงิน ไม่ใช่คนกดสั่ง",
    report.byStaff.find((row) => row.staffId === owner.id)?.total === c.total,
  );

  console.log("\n── ขอบช่วงตามเวลาสาขา ──────────────────────────────────────────\n");

  /**
   * ยืนยันก่อนว่าเทสต์สร้าง "เวลา" ที่ตั้งใจจริง ๆ
   *
   * ถ้าข้ามขั้นนี้ ตัวช่วยเรื่องเขตเวลาที่เขียนผิดจะทำให้เทสต์ฟ้องว่าโค้ดจริงผิด
   * ทั้งที่โค้ดจริงถูก — เกิดมาแล้วหนึ่งครั้งตอนเขียนชุดนี้
   */
  const lastMinuteAt = endOfBranchDay(todayYmd, timezone);
  const nextMidnightAt = startOfNextBranchDay(todayYmd, timezone);

  check(
    "เทสต์สร้างเวลา 23:xx ของวันนี้ตามเวลาสาขาได้จริง",
    branchStamp(lastMinuteAt, timezone) === `${todayYmd} 23`,
    branchStamp(lastMinuteAt, timezone),
  );
  check(
    "เทสต์สร้างเวลา 00:xx ของวันถัดไปตามเวลาสาขาได้จริง",
    branchStamp(nextMidnightAt, timezone) !== `${todayYmd} 23` &&
      branchStamp(nextMidnightAt, timezone).endsWith(" 00"),
    branchStamp(nextMidnightAt, timezone),
  );

  const lastMinute = await sellOneBill(cashier, table.id, "CASH", 1, lastMinuteAt);
  const nextMidnight = await sellOneBill(cashier, table.id, "CASH", 1, nextMidnightAt);

  const edged = await getSalesReport(branchId, range, timezone);

  check(
    "บิลตอน 23:59 ของวันสุดท้ายถูกนับ",
    edged.revenue === report.revenue + lastMinute.total,
    `${edged.revenue - report.revenue} vs ${lastMinute.total}`,
  );
  check(
    "บิลตอนเที่ยงคืนของวันถัดไปไม่ถูกนับ",
    edged.revenue !== report.revenue + lastMinute.total + nextMidnight.total,
  );

  const otherBranch = await prisma.branch.findFirst({ where: { id: { not: branchId } } });

  if (otherBranch) {
    check(
      "ไม่ข้ามสาขา",
      (await getSalesReport(otherBranch.id, range, timezone)).revenue === 0,
    );
  }

  console.log("\n── เมนูขายดี ───────────────────────────────────────────────────\n");

  const itemRow = edged.byItem.find((row) => row.menuItemId === KRAPAO);
  check("เมนูที่ขายไปโผล่ในลิสต์", itemRow !== undefined);
  check(
    "จำนวนชิ้นรวมถูกต้อง (2 + 1 + 3 + 1 = 7 ชิ้นจากบิลที่อยู่ในช่วง)",
    itemRow?.quantity === 7,
    `${itemRow?.quantity}`,
  );
  check("ใช้ชื่อที่ snapshot ไว้ ไม่ใช่ join เมนูสด", typeof itemRow?.name === "string");
  check("itemsSold รวมเท่ากับผลรวมของลิสต์", edged.itemsSold === 7, `${edged.itemsSold}`);

  // ── บิลที่ยังไม่จ่ายต้องไม่ถูกนับ ──
  const openedForUnpaid = await openTableByStaff(cashier, table.id, 2);

  if (!openedForUnpaid.ok) {
    throw new Error(`เปิดโต๊ะไม่สำเร็จ: ${openedForUnpaid.errorKey}`);
  }

  const unpaidSession = await prisma.tableSession.findFirstOrThrow({
    where: { tableId: table.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  await addToCart({
    tableSessionId: unpaidSession.id,
    branchId,
    tableId: table.id,
    timezone,
    menuItemId: KRAPAO,
    quantity: 5,
    modifierIds: KRAPAO_OPTIONS,
    note: null,
  });
  await placeOrder(unpaidSession.id, { placedByStaffId: cashier.id });

  const withUnpaid = await getSalesReport(branchId, range, timezone);

  check(
    "ของในบิลที่ยังไม่จ่ายไม่ถูกนับ (ต่างจากหน้าสรุปวันนี้โดยตั้งใจ)",
    withUnpaid.itemsSold === 7,
    `${withUnpaid.itemsSold}`,
  );
  check("บิลที่ยังไม่จ่ายไม่ทำให้รายได้ขยับ", withUnpaid.revenue === edged.revenue);

  // ── รายการที่ถูกยกเลิกต้องไม่ถูกนับ ──
  const paidSession = await prisma.payment.findUniqueOrThrow({
    where: { id: a.paymentId },
    select: { tableSessionId: true },
  });

  await prisma.orderItem.updateMany({
    where: { order: { tableSessionId: paidSession.tableSessionId } },
    data: { status: "CANCELLED" },
  });

  const withCancelled = await getSalesReport(branchId, range, timezone);

  check(
    "รายการที่ถูกยกเลิกหายไปจากจำนวนชิ้น",
    withCancelled.itemsSold === 5,
    `${withCancelled.itemsSold}`,
  );
  check(
    "แต่เงินที่รับไปแล้วยังอยู่ในรายได้ (ยกเลิกรายการไม่ใช่การคืนเงิน)",
    withCancelled.revenue === edged.revenue,
  );

  console.log("\n── ล้างข้อมูลที่สร้างระหว่างทดสอบ ───────────────────────────────\n");

  await cleanup(branchId);
  check(
    "ล้างข้อมูลทดสอบหมดแล้ว",
    (await prisma.restaurantTable.count({ where: { branchId, name: TABLE_NAME } })) === 0,
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
