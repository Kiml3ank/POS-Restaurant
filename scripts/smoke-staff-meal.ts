import "dotenv/config";

import { calculateBill } from "@/lib/bill";
import { auditActionLabel, auditMetadataFields } from "@/lib/audit-log";
import { canReadAuditLog, canSetStaffMeal } from "@/lib/rbac";
import { addToCart, placeOrder } from "@/lib/server/cart";
import { listAuditLogs } from "@/lib/server/audit";
import { getTableBill } from "@/lib/server/billing";
import { prisma } from "@/lib/server/db";
import { takePayment } from "@/lib/server/payment";
import { clearStaffMeal, setStaffMeal, staffMealDiscountAmount } from "@/lib/server/staff-meal";
import type { CurrentStaff } from "@/lib/server/staff-session";
import { openOrJoinTableSession } from "@/lib/server/table-session";

/**
 * Smoke test ของส่วนลดพนักงาน + หน้าอ่าน AuditLog (บทที่ 13a)
 *
 *     npm run smoke:staff-meal
 *
 * ใช้โต๊ะ **B1** (และ A3 เฉพาะเคส "หนึ่งคน หนึ่งบิลที่เปิดอยู่")
 *
 * ── สิ่งที่ไฟล์นี้มีไว้พิสูจน์เป็นอันดับแรก ────────────────────────────────
 * **ส่วนลดขยับตามยอดบิลเสมอ** — เพราะเก็บ "ใครกิน" ไม่ได้เก็บ "ลดกี่บาท"
 * ถ้าวันหนึ่งมีคนเปลี่ยนไปเก็บจำนวนเงิน เทสต์นี้จะพังทันที ซึ่งเป็นสิ่งที่ต้องการ
 */

const TABLE_ID = "seed-table-b1";
const OTHER_TABLE_ID = "seed-table-a3";

const KRAPAO = "seed-item-krapao";
const KRAPAO_OPTIONS = ["seed-mod-spice-mild", "seed-mod-size-regular"];

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed++;
  else {
    failed++;
    process.exitCode = 1;
  }
}

async function loadStaff(id: string): Promise<CurrentStaff> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { branch: true } });
}

/** ล้างโต๊ะ — ใบเสร็จ → ออร์เดอร์ → การรับเงิน → รอบโต๊ะ (Restrict ทุกชั้น) */
async function resetTable(tableId: string) {
  const sessions = await prisma.tableSession.findMany({
    where: { tableId },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  const paymentIds = (
    await prisma.payment.findMany({
      where: { tableSessionId: { in: sessionIds } },
      select: { id: true },
    })
  ).map((payment) => payment.id);

  const receiptIds = (
    await prisma.receipt.findMany({
      where: { paymentId: { in: paymentIds } },
      select: { id: true },
    })
  ).map((receipt) => receipt.id);

  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [...sessionIds, ...paymentIds, ...receiptIds] } },
  });
  await prisma.order.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.receipt.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { tableSessionId: { in: sessionIds } } });
  await prisma.tableSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.restaurantTable.update({ where: { id: tableId }, data: { status: "AVAILABLE" } });
}

/** เปิดโต๊ะแล้วสั่งกะเพรา `quantity` จาน */
async function seedOrder(tableId: string, branchId: string, timezone: string, quantity: number) {
  const session = await openOrJoinTableSession({ tableId, branchId, pax: 1 });

  await addToCart({
    tableSessionId: session.id,
    branchId,
    tableId,
    timezone,
    note: null,
    menuItemId: KRAPAO,
    quantity,
    modifierIds: KRAPAO_OPTIONS,
  });
  await placeOrder(session.id);

  return session;
}

async function main() {
  const branch = await prisma.branch.findFirstOrThrow();
  const owner = await loadStaff("seed-staff-owner");
  const cashier = await loadStaff("seed-staff-cashier");
  const server = await loadStaff("seed-staff-server");
  const kitchen = await loadStaff("seed-staff-kitchen");

  // ── 1. ฟังก์ชันคิดส่วนลด — จำนวนเต็มล้วน ────────────────────────────────
  check("10% ของ 18000 = 1800", staffMealDiscountAmount(18_000, 1_000) === 1_800);
  check("ปัดครึ่งขึ้น: 10% ของ 15 = 2", staffMealDiscountAmount(15, 1_000) === 2);
  check("อัตรา 0 = ไม่ลด", staffMealDiscountAmount(18_000, 0) === 0);
  check("ยอด 0 = ไม่ลด", staffMealDiscountAmount(0, 1_000) === 0);
  check("ยอดติดลบ = ไม่ลด (กันค่าเพี้ยน)", staffMealDiscountAmount(-500, 1_000) === 0);
  check(
    "ลดเกิน 100% ถูก clamp ไม่ให้เกินยอดค่าอาหาร",
    staffMealDiscountAmount(18_000, 20_000) === 18_000,
  );
  check(
    "ผลลัพธ์เป็นจำนวนเต็มเสมอ",
    Number.isInteger(staffMealDiscountAmount(12_345, 1_000)),
    String(staffMealDiscountAmount(12_345, 1_000)),
  );

  // ── 2. สิทธิ์ ───────────────────────────────────────────────────────────
  check("เจ้าของติดธงได้", canSetStaffMeal("OWNER"));
  check("แคชเชียร์ติดธงได้", canSetStaffMeal("CASHIER"));
  check("พนักงานเสิร์ฟติดธงได้ (ทุกคนกินจริง)", canSetStaffMeal("SERVER"));
  check("ครัวติดธงได้", canSetStaffMeal("KITCHEN"));
  check("เจ้าของอ่าน AuditLog ได้", canReadAuditLog("OWNER"));
  check("ผู้จัดการอ่าน AuditLog ได้", canReadAuditLog("MANAGER"));
  check("แคชเชียร์อ่าน AuditLog ไม่ได้", !canReadAuditLog("CASHIER"));
  check("ครัวอ่าน AuditLog ไม่ได้", !canReadAuditLog("KITCHEN"));

  await resetTable(TABLE_ID);
  await resetTable(OTHER_TABLE_ID);

  // ── 3. บิลปกติ ยังไม่มีส่วนลด ───────────────────────────────────────────
  await seedOrder(TABLE_ID, branch.id, branch.timezone, 2);

  const plain = await getTableBill(branch.id, TABLE_ID);
  if (!plain) throw new Error("อ่านบิลไม่ได้");
  check("บิลปกติไม่มีส่วนลด", plain.bill.discountAmount === 0 && plain.discountBp === 0);

  const subtotal = plain.bill.subtotal;
  check("มียอดค่าอาหารให้ทดสอบ", subtotal > 0, String(subtotal));

  // ── 4. ติดธง → ส่วนลดโผล่ทันที ─────────────────────────────────────────
  const setResult = await setStaffMeal(cashier, TABLE_ID, kitchen.id);
  check("แคชเชียร์ติดธงให้ครัวได้ (คนกดกับคนกินคนละคน)", setResult.ok);

  const flagged = await getTableBill(branch.id, TABLE_ID);
  if (!flagged) throw new Error("อ่านบิลไม่ได้");

  const expected = staffMealDiscountAmount(subtotal, branch.staffMealDiscountBp);
  check(
    "ส่วนลดเท่ากับอัตราของสาขา",
    flagged.bill.discountAmount === expected,
    `${flagged.bill.discountAmount} vs ${expected}`,
  );
  check("อัตราที่คืนมาตรงกับ Branch", flagged.discountBp === branch.staffMealDiscountBp);
  check("บิลรู้ว่าใครกิน", flagged.session?.staffCustomerId === kitchen.id);
  check("บิลรู้ว่าใครกด", flagged.session?.staffMealSetById === cashier.id);
  check(
    "ยอดรวมลดลงจริง",
    flagged.bill.grandTotal < plain.bill.grandTotal,
    `${plain.bill.grandTotal} → ${flagged.bill.grandTotal}`,
  );
  check(
    "netAmount + vat = grandTotal ยังจริงหลังลด",
    flagged.bill.netAmount + flagged.bill.vatAmount === flagged.bill.grandTotal,
  );
  check(
    "เซอร์วิสชาร์จคิดจากยอดหลังหักส่วนลด",
    flagged.bill.serviceChargeAmount < plain.bill.serviceChargeAmount,
    `${plain.bill.serviceChargeAmount} → ${flagged.bill.serviceChargeAmount}`,
  );

  // ── 5. ⭐ สั่งเพิ่มแล้วส่วนลดต้องขยับตาม ────────────────────────────────
  //
  // นี่คือเหตุผลทั้งหมดที่เก็บ "ใครกิน" แทน "ลดกี่บาท" — ถ้าวันหนึ่งมีคนเปลี่ยน
  // ไปเก็บจำนวนเงินที่คิดไว้ตอนกด เคสนี้จะพังทันที ซึ่งเป็นสิ่งที่ต้องการ
  const sessionRow = await prisma.tableSession.findFirstOrThrow({
    where: { tableId: TABLE_ID, status: "OPEN" },
    select: { id: true },
  });

  await addToCart({
    tableSessionId: sessionRow.id,
    branchId: branch.id,
    tableId: TABLE_ID,
    timezone: branch.timezone,
    note: null,
    menuItemId: KRAPAO,
    quantity: 3,
    modifierIds: KRAPAO_OPTIONS,
  });
  await placeOrder(sessionRow.id);

  const bigger = await getTableBill(branch.id, TABLE_ID);
  if (!bigger) throw new Error("อ่านบิลไม่ได้");

  check(
    "ยอดค่าอาหารเพิ่มขึ้นจริง",
    bigger.bill.subtotal > subtotal,
    `${subtotal} → ${bigger.bill.subtotal}`,
  );
  check(
    "⭐ ส่วนลดขยับตามยอดใหม่ ไม่ค้างที่ยอดเก่า",
    bigger.bill.discountAmount === staffMealDiscountAmount(bigger.bill.subtotal, branch.staffMealDiscountBp),
    `${flagged.bill.discountAmount} → ${bigger.bill.discountAmount}`,
  );
  check("ส่วนลดใหม่มากกว่าเดิม", bigger.bill.discountAmount > flagged.bill.discountAmount);

  // ── 6. หนึ่งคน หนึ่งบิลที่เปิดอยู่ ───────────────────────────────────────
  await seedOrder(OTHER_TABLE_ID, branch.id, branch.timezone, 1);

  const clash = await setStaffMeal(owner, OTHER_TABLE_ID, kitchen.id);
  check("เอาชื่อคนเดิมไปแปะอีกโต๊ะพร้อมกันไม่ได้", !clash.ok, clash.ok ? "" : clash.errorKey);
  check(
    "ข้อความบอกด้วยว่าติดค้างอยู่โต๊ะไหน",
    !clash.ok && clash.errorKey.includes("B1"),
    clash.ok ? "" : clash.errorKey,
  );

  const otherPerson = await setStaffMeal(owner, OTHER_TABLE_ID, server.id);
  check("คนละคนกันติดคนละโต๊ะพร้อมกันได้", otherPerson.ok);

  // ── 7. พนักงานที่ถูกปิดใช้งาน / ไม่มีอยู่ ────────────────────────────────
  const missing = await setStaffMeal(owner, TABLE_ID, "ไม่มีพนักงานคนนี้");
  check("ใส่ id พนักงานมั่ว = ปฏิเสธ", !missing.ok);

  await prisma.staff.update({ where: { id: server.id }, data: { isActive: false } });
  try {
    await clearStaffMeal(owner, OTHER_TABLE_ID);
    const inactive = await setStaffMeal(owner, OTHER_TABLE_ID, server.id);
    check("พนักงานที่ปิดบัญชีแล้วใช้รับส่วนลดไม่ได้", !inactive.ok);
  } finally {
    await prisma.staff.update({ where: { id: server.id }, data: { isActive: true } });
  }

  // ── 8. ปลดธง → ยอดกลับเป็นราคาเต็ม ─────────────────────────────────────
  const beforeClear = await getTableBill(branch.id, TABLE_ID);
  const cleared = await clearStaffMeal(owner, TABLE_ID);
  check("ปลดธงสำเร็จ", cleared.ok);

  const afterClear = await getTableBill(branch.id, TABLE_ID);
  check("ส่วนลดหายไป", afterClear?.bill.discountAmount === 0);
  check("บิลไม่รู้จักคนกินแล้ว", afterClear?.session?.staffCustomerId === null);
  check(
    "ยอดกลับขึ้นเป็นราคาเต็ม",
    (afterClear?.bill.grandTotal ?? 0) > (beforeClear?.bill.grandTotal ?? 0),
  );

  const clearTwice = await clearStaffMeal(owner, TABLE_ID);
  check("ปลดซ้ำบนบิลที่ไม่มีธง = สำเร็จ ไม่ใช่ error", clearTwice.ok);

  // ── 9. ส่วนลดไหลเข้า Payment + ใบเสร็จ ─────────────────────────────────
  await setStaffMeal(cashier, TABLE_ID, kitchen.id);
  const toPay = await getTableBill(branch.id, TABLE_ID);
  if (!toPay) throw new Error("อ่านบิลไม่ได้");

  const paid = await takePayment(cashier, TABLE_ID, { method: "QR" });
  check("รับเงินบิลที่มีส่วนลดพนักงานได้", paid.ok, paid.ok ? "" : paid.errorKey);
  if (!paid.ok) throw new Error("รับเงินไม่สำเร็จ");

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paid.paymentId } });
  check(
    "Payment เก็บจำนวนส่วนลด",
    payment.discountAmount === toPay.bill.discountAmount,
    `${payment.discountAmount} vs ${toPay.bill.discountAmount}`,
  );
  check("Payment เก็บอัตราส่วนลด (ไว้พิมพ์ % บนใบย้อนหลัง)", payment.discountBp === branch.staffMealDiscountBp);
  check("Payment เก็บว่าใครกิน (หลักฐานถาวรหลังรอบโต๊ะปิด)", payment.staffCustomerId === kitchen.id);
  check(
    "ยอดที่เก็บจริงตรงกับที่หน้าจอแสดงก่อนกด",
    payment.grandTotal === toPay.bill.grandTotal,
  );
  check(
    "สูตรบนแถว Payment ยังบวกลงตัว",
    payment.netAmount + payment.vatAmount === payment.grandTotal,
  );

  const receipt = await prisma.receipt.findUniqueOrThrow({ where: { paymentId: paid.paymentId } });
  check("ยังออกใบเสร็จให้ตามปกติ", Boolean(receipt.number));

  // ── 10. บิลที่ปิดแล้วต้องแตะไม่ได้ ──────────────────────────────────────
  const afterPaid = await setStaffMeal(owner, TABLE_ID, kitchen.id);
  check("ติดธงบนโต๊ะที่ปิดบิลไปแล้วไม่ได้", !afterPaid.ok, afterPaid.ok ? "" : afterPaid.errorKey);

  // ── 11. AuditLog ต้องบันทึกครบทั้งติดและปลด ─────────────────────────────
  const logs = await prisma.auditLog.findMany({
    where: {
      branchId: branch.id,
      action: { in: ["table_session.staff_meal_set", "table_session.staff_meal_clear"] },
    },
    orderBy: { createdAt: "asc" },
  });

  check("มี log ของการติดธง", logs.some((log) => log.action === "table_session.staff_meal_set"));
  check(
    "⭐ มี log ของการ *ปลด* ธงด้วย (รูปแบบโกงคือ ติด → รับเงิน → ปลด)",
    logs.some((log) => log.action === "table_session.staff_meal_clear"),
  );

  const setLog = logs.find((log) => log.action === "table_session.staff_meal_set");
  const meta = (setLog?.metadata ?? {}) as Record<string, unknown>;
  check("log เก็บ id คนกิน", meta.staffCustomerId === kitchen.id);
  check("log เก็บชื่อคนกิน (อ่านได้แม้บัญชีถูกลบทีหลัง)", meta.staffCustomerName === kitchen.name);
  check("log เก็บยอดบิล ณ ตอนกด", typeof meta.subtotal === "number" && (meta.subtotal as number) > 0);
  check("log เก็บจำนวนส่วนลด ณ ตอนกด", typeof meta.discountAmount === "number");
  check("log เก็บอัตราส่วนลด", meta.discountBp === branch.staffMealDiscountBp);
  check("log เก็บสกุลเงิน (บิลเก่าอาจคนละสกุลกับสาขาตอนนี้)", meta.currency === branch.currency);
  check("log แยก 'คนกด' ออกจาก 'คนกิน'", setLog?.staffId !== meta.staffCustomerId);

  // ── 12. ตัวแปล metadata ต้องไม่ทำหน้าพัง ────────────────────────────────
  const fmt = (amount: number) => String(amount);
  check("action ที่มีป้ายไทยแปลได้", auditActionLabel("payment.take") === "รับเงิน / ปิดบิล");
  check(
    "⭐ action ที่ยังไม่รู้จักคืนชื่อดิบ ไม่ใช่ 'ไม่ทราบ'",
    auditActionLabel("something.brand_new") === "something.brand_new",
  );
  check("metadata = null ไม่พัง", auditMetadataFields(null, fmt).length === 0);
  check("metadata เป็น array ไม่พัง", auditMetadataFields([1, 2], fmt).length === 1);
  check("metadata เป็น string ไม่พัง", auditMetadataFields("hello", fmt).length === 1);
  check(
    "⭐ คีย์ที่ยังไม่มีป้ายยังต้องแสดง (ใช้ชื่อคีย์ดิบ) ห้ามซ่อนแถว",
    auditMetadataFields({ brandNewKey: "v" }, fmt).some((field) => field.label === "brandNewKey"),
  );
  check(
    "ค่า null/ว่างถูกข้าม ไม่รกหน้าจอ",
    auditMetadataFields({ a: null, b: "", c: "x" }, fmt).length === 1,
  );
  check("boolean แปลเป็นไทย", auditMetadataFields({ isCopy: true }, fmt)[0]?.value === "ใช่");
  check(
    "คีย์จำนวนเงินผ่านตัวจัดรูป",
    auditMetadataFields({ grandTotal: 100, currency: "THB" }, (amount) => `**${amount}**`).some(
      (field) => field.value === "**100**",
    ),
  );

  // ── 13. หน้าอ่าน AuditLog ───────────────────────────────────────────────
  const denied = await listAuditLogs(cashier, {});
  check("แคชเชียร์อ่าน log ไม่ได้", !denied.ok);
  const deniedKitchen = await listAuditLogs(kitchen, {});
  check("ครัวอ่าน log ไม่ได้", !deniedKitchen.ok);

  const all = await listAuditLogs(owner, {});
  check("เจ้าของอ่าน log ได้", all.ok);
  if (!all.ok) throw new Error("อ่าน log ไม่ได้");

  check("มี log ให้อ่าน", all.total > 0, `${all.total} รายการ`);
  check(
    "เรียงใหม่ไปเก่า",
    all.rows.every(
      (row, index) => index === 0 || row.createdAt.getTime() <= all.rows[index - 1].createdAt.getTime(),
    ),
  );
  check(
    "⭐ รายการ action ในกล่องกรองมาจากของจริงในฐาน ไม่ได้ hardcode",
    all.actions.includes("table_session.staff_meal_set"),
    all.actions.join(","),
  );
  check("รายชื่อพนักงานสำหรับกล่องกรองมาครบ", all.staff.length >= 4);

  const byAction = await listAuditLogs(owner, { action: "table_session.staff_meal_set" });
  check(
    "กรองด้วย action ได้",
    byAction.ok && byAction.rows.every((row) => row.action === "table_session.staff_meal_set"),
  );

  const byStaff = await listAuditLogs(owner, { staffId: cashier.id });
  check("กรองด้วยพนักงานได้", byStaff.ok && byStaff.rows.every((row) => row.staffName === cashier.name));

  const byEntity = await listAuditLogs(owner, { entityId: paid.paymentId });
  check("ค้นด้วย entityId เจอ log ของการรับเงินใบนั้น", byEntity.ok && byEntity.total > 0);

  const future = await listAuditLogs(owner, { from: "2099-01-01" });
  check("กรองอนาคต = 0 แถว", future.ok && future.total === 0);
  check("วันที่รูปแบบผิดไม่ทำให้พัง", (await listAuditLogs(owner, { from: "ไม่ใช่วันที่" })).ok);
  check("page ติดลบถูกดันกลับเป็น 1", (await listAuditLogs(owner, { page: -3 })).ok);

  // ── 14. บิลที่ไม่มีส่วนลดต้องได้ผลเหมือนก่อนบทนี้ทุกประการ ─────────────
  await resetTable(TABLE_ID);
  await seedOrder(TABLE_ID, branch.id, branch.timezone, 2);
  const noDiscount = await getTableBill(branch.id, TABLE_ID);
  const reference = calculateBill({
    subtotal: noDiscount?.bill.subtotal ?? 0,
    rates: {
      serviceChargeBp: branch.serviceChargeBp,
      vatRateBp: branch.vatRateBp,
      pricesIncludeVat: branch.pricesIncludeVat,
    },
  });
  check(
    "บิลที่ไม่ได้ติดธงคิดได้เท่าเดิมเป๊ะ (ไม่ทำของเดิมพัง)",
    noDiscount?.bill.grandTotal === reference.grandTotal,
    `${noDiscount?.bill.grandTotal} vs ${reference.grandTotal}`,
  );

  await resetTable(TABLE_ID);
  await resetTable(OTHER_TABLE_ID);

  console.log(`\nรวม ${passed + failed} เคส · PASS ${passed} · FAIL ${failed}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
